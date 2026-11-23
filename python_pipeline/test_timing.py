import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from models import RecapClip
from timing import approximate_subtitles
from video_renderer import probe_duration, render_16x9_recap


class NarrationTimingTests(unittest.TestCase):
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

    def test_probe_does_not_silently_guess_duration(self):
        for output in ['N/A', 'nan', '0', '-1', 'inf']:
            with patch('video_renderer.subprocess.run', return_value=SimpleNamespace(stdout=output)):
                with self.assertRaisesRegex(ValueError, 'Could not measure'):
                    probe_duration('bad.mp3')

    def test_video_only_export_writes_srt_from_clip_duration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.mp4'
            source.write_bytes(b'video')
            clips = [RecapClip(id=i + 1, source_start=i * 6, source_end=(i + 1) * 6,
                              english_script='', burmese_script='မင်္ဂလာပါ။') for i in range(2)]
            commands = []

            def run(command, **kwargs):
                commands.append(command)
                Path(command[-1]).write_bytes(b'rendered')
                return SimpleNamespace(stdout='')

            with patch('video_renderer.get_job_dir', return_value=root), patch('video_renderer.RENDERS_DIR', root), patch('video_renderer.probe_duration', return_value=12), patch('video_renderer.subprocess.run', side_effect=run):
                result = render_16x9_recap(str(source), clips, include_subtitles=False)
            srt = Path(result['srt_path']).read_text()
            self.assertIn('00:00:00,000 --> 00:00:06,000', srt)
            self.assertIn('00:00:06,000 --> 00:00:12,000', srt)
            self.assertEqual(srt.count('မင်္ဂလာပါ။'), 2)
            self.assertNotIn('amix', ' '.join(commands[0]))


if __name__ == '__main__':
    unittest.main()
