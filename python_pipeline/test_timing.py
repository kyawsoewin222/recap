import asyncio
import json
import tempfile
import warnings
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from edge_tts_service import generate_edge_tts, probe_duration
from models import RecapClip
from timing import approximate_subtitles, narration_timing, subtitle_cues
from video_renderer import render_16x9_recap


class NarrationTimingTests(unittest.TestCase):
    def test_long_narration_is_not_capped_by_target(self):
        duration, speed = narration_timing(0, 25, 24.75)
        self.assertEqual((duration, speed), (25, 1))
        self.assertEqual(narration_timing(0, 6.2, 5.4)[0], 5.68)
        with self.assertRaisesRegex(ValueError, "Needs review"):
            narration_timing(0, 4, 24.75)

    def test_speed_limits_and_invalid_durations(self):
        self.assertAlmostEqual(narration_timing(0, 8.5, 9.75)[1], 0.85)
        self.assertAlmostEqual(narration_timing(0, 11.5, 9.75)[1], 1.15)
        for start, end, audio in [(0, 8.49, 9.75), (0, 11.51, 9.75), (0, 4, float('nan')), (-1, 4, 2), (4, 4, 2)]:
            with self.assertRaises(ValueError):
                narration_timing(start, end, audio)

    def test_burmese_phrases_preserve_unicode_and_stop_at_speech_end(self):
        text = 'မင်္ဂလာပါ။ လုရှောင်က ပြည်သူတွေကို ကယ်တင်ပါတယ်။'
        cues = approximate_subtitles(text, 10)
        self.assertGreater(len(cues), 1)
        self.assertEqual(''.join(''.join(c[2].split()) for c in cues), ''.join(text.split()))
        previous_end = 0
        for start, end, _ in cues:
            self.assertGreaterEqual(start, previous_end)
            self.assertGreater(end, start)
            self.assertLessEqual(end, 10)
            previous_end = end
        self.assertAlmostEqual(cues[-1][1], 10)

    def test_unbreakable_long_paragraph_is_flagged_not_sliced(self):
        with self.assertRaisesRegex(ValueError, 'subtitle review'):
            approximate_subtitles('မင်္ဂလာပါ' * 30, 20)

    def test_native_boundaries_are_grouped_without_guessed_timing(self):
        boundaries = [
            {"offset": 2_000_000, "duration": 4_000_000, "text": "မင်္ဂလာပါ"},
            {"offset": 7_000_000, "duration": 5_000_000, "text": "လုရှောင်"},
            {"offset": 15_000_000, "duration": 20_000_000, "text": "ပြောပါတယ်။"},
        ]
        cues, mode = subtitle_cues("မင်္ဂလာပါ လုရှောင် ပြောပါတယ်။", 4, boundaries)
        self.assertEqual(mode, "tts-boundaries")
        self.assertEqual(cues[0][0], 0.2)
        self.assertEqual(cues[-1][1], 3.5)
        self.assertLess(len(cues), len(boundaries))
        bad_cues, bad_mode = subtitle_cues("မတူပါ။", 4, boundaries)
        self.assertEqual(bad_mode, "approximate")
        self.assertEqual(bad_cues[-1][1], 4)

    def test_probe_does_not_silently_guess_duration(self):
        for output in ['N/A', 'nan', '0', '-1', 'inf']:
            with patch('edge_tts_service.subprocess.run', return_value=SimpleNamespace(stdout=output)):
                with self.assertRaisesRegex(ValueError, 'Could not measure'):
                    probe_duration('bad.mp3')

    def test_tts_does_not_accelerate_or_accept_empty_narration(self):
        for text, rate in [('မင်္ဂလာပါ', '+50%'), (' ', '+0%')]:
            with self.assertRaises(ValueError):
                asyncio.run(generate_edge_tts(1, text, rate=rate))

    def test_concat_uses_planned_durations_instead_of_aac_mux_padding(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.mp4'
            source.write_bytes(b'video')
            audio = root / 'clip.mp3'
            audio.write_bytes(b'audio')
            text = 'မင်္ဂလာပါ။'
            audio.with_suffix('.json').write_text(json.dumps({'text': text}))
            clips = [RecapClip(id=i + 1, source_start=i * 6.2, source_end=(i + 1) * 6.2,
                              target_duration=4, english_script='', burmese_script=text,
                              audio_path=str(audio)) for i in range(2)]
            commands = []

            def run(command, **kwargs):
                commands.append(command)
                Path(command[-1]).write_bytes(b'rendered')
                return SimpleNamespace(stdout='')

            def duration(path):
                path = Path(path)
                return 20 if path == source else 5.4 if path == audio else 5.701

            with patch('video_renderer.get_job_dir', return_value=root), patch('video_renderer.RENDERS_DIR', root), patch('video_renderer.probe_duration', side_effect=duration), patch('video_renderer.subprocess.run', side_effect=run), warnings.catch_warnings():
                warnings.simplefilter('ignore')
                result = render_16x9_recap(str(source), clips, include_subtitles=False)
            concat = next(root.glob('render-*/concat.txt')).read_text()
            self.assertEqual(concat.count('duration 5.680000'), 2)
            final_command = commands[-1]
            self.assertEqual(final_command[final_command.index('-t') + 1], '11.360000')
            second_start = Path(result['srt_path']).read_text().split('\n\n')[1].splitlines()[1].split(' --> ')[0]
            self.assertIn(second_start, ('00:00:05,679', '00:00:05,680'))

    def test_missing_or_stale_audio_is_rejected_before_ffmpeg(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.mp4'
            source.write_bytes(b'video')
            audio = Path(directory) / 'clip.mp3'
            audio.write_bytes(b'audio')
            clip = RecapClip(id=1, source_start=0, source_end=4, target_duration=4,
                            english_script='', burmese_script='မင်္ဂလာပါ')
            with patch('video_renderer.get_job_dir', return_value=Path(directory)), patch('video_renderer.probe_duration', return_value=10), patch('video_renderer.subprocess.run') as ffmpeg:
                with self.assertRaisesRegex(ValueError, 'narration is missing'):
                    render_16x9_recap(str(source), [clip])
                clip.audio_path = str(audio)
                audio.with_suffix('.json').write_text(json.dumps({'text': 'old text'}))
                with self.assertRaisesRegex(ValueError, 'narration changed'):
                    render_16x9_recap(str(source), [clip])
                ffmpeg.assert_not_called()


if __name__ == '__main__':
    unittest.main()
