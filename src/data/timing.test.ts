import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateBurmeseSpeechSec, getClipPaceCheck, getTightClipDuration, wrapBurmeseCueLines } from './timing.ts';

test('1.0x pace estimator flags overly long Burmese narration and excess silence gaps', () => {
  const shortLine = 'လုရှောင်က ပြည်သူတွေကို ချက်ချင်းကယ်ဖို့ မြင်းတပ်နဲ့ လိုက်သွားပါတယ်။';
  const longLine = 'စစ်ပြေငြိမ်းစာချုပ်မချုပ်ခင် ရန်သူတွေ ဖမ်းခေါ်သွားတဲ့ နယ်စပ်ပြည်သူထောင်ချီ ဘယ်ရောက်နေလဲဆိုတာကို လုရှောင်က စတင်မေးမြန်းလိုက်ပြီး တံတားပေါ်မှာ တားဆီးလိုက်ပါတယ်။';
  assert.ok(estimateBurmeseSpeechSec(shortLine) < 7);
  const tight = getTightClipDuration(shortLine);
  assert.ok(tight > estimateBurmeseSpeechSec(shortLine) && tight < estimateBurmeseSpeechSec(shortLine) + 1);
  assert.equal(getClipPaceCheck({ sourceStart: 0, sourceEnd: tight, burmeseScript: shortLine }).hasExcessGap, false);
  assert.equal(getClipPaceCheck({ sourceStart: 0, sourceEnd: 15, burmeseScript: shortLine }).hasExcessGap, true);
  assert.equal(getClipPaceCheck({ sourceStart: 0, sourceEnd: 4, burmeseScript: longLine }).status, 'long');
  const wrapped = wrapBurmeseCueLines(shortLine, 26);
  assert.ok(wrapped.split('\n').length <= 2);
  assert.equal(wrapped.replace(/\s/g, ''), shortLine.replace(/\s/g, ''));
});
