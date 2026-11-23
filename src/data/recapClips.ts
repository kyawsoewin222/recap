export interface RecapClip {
  id: number;
  title: string;
  sourceStart: number;
  sourceEnd: number;
  targetDuration: number;
  englishScript: string;
  burmeseScript: string;
}

export interface RenderResult {
  videoUrl: string;
  srtUrl: string;
  downloadUrl?: string;
  durationSec: number;
  fileSizeBytes: number;
  width: number;
  height: number;
}

export const SOURCE_VIDEO_URL =
  '/assets/aistudio/part9.mp4';

export const INITIAL_RECAP_CLIPS: RecapClip[] = [
  {
    id: 1,
    title: '01. Tracking Missing Villagers',
    sourceStart: 0.0,
    sourceEnd: 6.2,
    targetDuration: 4.3,
    englishScript:
      'Before discussing any peace treaty, Lu Xiao demands to know where the northern raiders hid the thousands of abducted villagers.',
    burmeseScript:
      'စစ်ပြေငြိမ်းစာချုပ်မချုပ်ခင် ရန်သူတွေ ဖမ်းခေါ်သွားတဲ့ နယ်စပ်ပြည်သူထောင်ချီ ဘယ်ရောက်နေလဲဆိုတာကို လုရှောင်က စတင်မေးမြန်းလိုက်ပါတယ်။',
  },
  {
    id: 2,
    title: '02. Flashback Of Secret Escort',
    sourceStart: 6.2,
    sourceEnd: 12.8,
    targetDuration: 4.5,
    englishScript:
      'Seeing the Helan Khan hesitate on the bridge, memories flash to wolf riders quietly marching thousands of bound captives north.',
    burmeseScript:
      'ခန်မင်းကြီး မျက်နှာပျက်ပြီး တုံ့ဆိုင်းသွားချိန်မှာပဲ ဝံပုလွေမြင်းတပ်တွေက ပြည်သူထောင်ချီကို မြောက်ဘက်သို့ တိတ်တဆိတ်ခေါ်ထုတ်သွားတာကို မြင်တွေ့ရပါတယ်။',
  },
  {
    id: 3,
    title: '03. Second Rocket Ultimatum',
    sourceStart: 12.8,
    sourceEnd: 19.6,
    targetDuration: 4.5,
    englishScript:
      'Lu Xiao warns sternly that if even a single civilian goes missing, his second rocket flies straight into the Khan’s headquarters.',
    burmeseScript:
      'လူတစ်ယောက်လျော့တာနဲ့ ဒုတိယဒုံးကျည်ကို ရန်သူ့စစ်ဌာနချုပ်တဲကြီးဆီ တည့်တည့်ပစ်လွှတ်မယ်လို့ လုရှောင်က ပြတ်ပြတ်သားသား သတိပေးလိုက်ပါတယ်။',
  },
  {
    id: 4,
    title: '04. Feigning Ignorance On Bridge',
    sourceStart: 19.6,
    sourceEnd: 29.2,
    targetDuration: 5.1,
    englishScript:
      'Blaming lower tribes for seizing prisoners without orders, the Khan claims commanding 200,000 troops leaves no way to track every captive.',
    burmeseScript:
      'ခန်မင်းကြီးကတော့ အောက်ခြေတပ်တွေ ကိုယ့်သဘောနဲ့ကိုယ် ဖမ်းခဲ့တာဖြစ်ပြီး စစ်သည်နှစ်သိန်းကြားမှာ လူတချို့ဘယ်ရောက်မှန်း မမှတ်မိဘူးလို့ ဗြောင်ငြင်းလိုက်ပါတယ်။',
  },
  {
    id: 5,
    title: '05. Jogging Memory With Scope',
    sourceStart: 29.2,
    sourceEnd: 34.8,
    targetDuration: 4.2,
    englishScript:
      'Raising the launcher right onto his shoulder, Lu Xiao aligns the optic directly at the central command tent so his men remember fast.',
    burmeseScript:
      'မမှတ်မိလည်း ကိစ္စမရှိဘူး၊ နောက်တစ်ချက်ပစ်ချလိုက်ရင် မင်းလူတွေ အလိုလိုပြန်သတိရလာလိမ့်မယ်ဆိုပြီး လုရှောင်က လောင်ချာကို ပြန်ချိန်လိုက်ပါတယ်။',
  },
  {
    id: 6,
    title: '06. Taunting Fast Steppes Horses',
    sourceStart: 34.8,
    sourceEnd: 43.2,
    targetDuration: 4.8,
    englishScript:
      'Sneering the escort fled hours ago on swift steppe mounts leaving only bones behind, the Khan drives Wei Chengyue to draw steel across his escape.',
    burmeseScript:
      'ဖမ်းခေါ်သွားတဲ့တပ်က မြင်းမြန်တွေနဲ့ အဝေးကြီးရောက်နေပြီလို့ ခန်မင်းကြီးက ခနဲ့လိုက်တာကြောင့် ဝေ့ချန်ယွဲ့က ဓားဆွဲထုတ်ပြီး ထွက်ပေါက်ကို ပိတ်ထားလိုက်ပါတယ်။',
  },
  {
    id: 7,
    title: '07. Hostage Detained On Bridge',
    sourceStart: 43.2,
    sourceEnd: 52.8,
    targetDuration: 5.2,
    englishScript:
      'Declaring zero peace talks until the villagers return, the Emperor traps the outraged Khan on the bridge since abducting Yan folk invites retaliation.',
    burmeseScript:
      'ပြည်သူတွေ ပြန်မရောက်မချင်း စာချုပ်အကြောင်းမပြောဘူးဆိုပြီး ဘုရင်ကြီးက ခန်မင်းကြီးကိုပါ တံတားပေါ်မှာ ဓားစာခံအဖြစ် ဖမ်းဆီးထိန်းသိမ်းလိုက်ပါတယ်။',
  },
  {
    id: 8,
    title: '08. Guard Horsemen Frozen',
    sourceStart: 52.8,
    sourceEnd: 57.6,
    targetDuration: 3.9,
    englishScript:
      'Northern bodyguards charge the timber bridge with drawn sabers, only to rein up frozen the moment Lu Xiao points his rocket barrel.',
    burmeseScript:
      'ရန်သူကိုယ်ရံတော်မြင်းတပ်တွေ ဓားဆွဲပြီး ဝင်ကယ်ဖို့ကြိုးစားပေမယ့် လုရှောင်က လောင်ချာနဲ့ချိန်ထားတာမြင်တော့ ရှေ့ဆက်မတိုးရဲကြတော့ပါဘူး။',
  },
  {
    id: 9,
    title: '09. Ashitu Lie Summoned',
    sourceStart: 57.6,
    sourceEnd: 66.2,
    targetDuration: 4.8,
    englishScript:
      'Knowing captive Ashitu Lie knows their northern trails, Lu Xiao orders him dragged to the bridgehead where the warlord trembles at sight of the tube.',
    burmeseScript:
      'လမ်းကြောင်းသိတဲ့ အာရှီထူလျဲ့ကို တံတားထိပ်ခေါ်ထုတ်ခိုင်းလိုက်ရာ လုရှောင်ရဲ့ လောင်ချာကြီးကို မြင်လိုက်တာနဲ့ ခြေထောက်တွေ ပျော့ခွေသွားပါတော့တယ်။',
  },
  {
    id: 10,
    title: '10. Route To Black Wolf Gorge',
    sourceStart: 66.2,
    sourceEnd: 74.8,
    targetDuration: 4.9,
    englishScript:
      'Collapsing onto his knees in terror, Ashitu Lie spills that Alechilu’s 2,000 wolf riders are herding 3,000 captives northwest toward Black Wolf Gorge.',
    burmeseScript:
      'ကြောက်လန့်ပြီး ဒူးထောက်ချလိုက်တဲ့ အာရှီထူလျဲ့က တပ်မှူးအာလဲ့ချီလိုဟာ ပြည်သူသုံးထောင်ကျော်ကို မိုင်နှစ်ဆယ်အကွာ ဝံပုလွေနက်ချောက်ကြားဘက် ခေါ်သွားကြောင်း ဖွင့်ဟလိုက်ပါတယ်။',
  },
  {
    id: 11,
    title: '11. Sword Map On Planks',
    sourceStart: 74.8,
    sourceEnd: 82.6,
    targetDuration: 4.6,
    englishScript:
      'Tracing cliffs with twin blades on the bridge planks, Han Qingcang warns three steppe trails fan beyond the gorge just as Lu Zhenyue hoists his axe.',
    burmeseScript:
      'ချောက်ကြားကျော်သွားရင် မြက်ခင်းလမ်းသုံးသွယ် ခွဲထွက်သွားမှာမို့ လိုက်ဖမ်းဖို့ခက်မယ်လို့ တပ်မှူးဟန်က သုံးသပ်ချိန်မှာ စစ်သူကြီးလုက ချက်ချင်းလိုက်ဖို့ ပြင်လိုက်ပါတယ်။',
  },
  {
    id: 12,
    title: '12. Mocking Mountain Trails',
    sourceStart: 82.6,
    sourceEnd: 92.0,
    targetDuration: 5.1,
    englishScript:
      'Regaining swagger, the captive Khan mocks that Alechilu rides spare mounts and will cross the gorge well ahead of exhausted Yan horses.',
    burmeseScript:
      'ဒါကိုကြားတော့ ခန်မင်းကြီးက ရန်သူတွေမှာ တစ်ယောက်ကို မြင်းနှစ်စီးစီပါလို့ မင်းတို့လိုက်မီခင် ဝံပုလွေနက်ချောက်ကြားကို ကျော်သွားပြီးသားဖြစ်နေမယ်လို့ လှောင်ပြောင်လိုက်ပါတယ်။',
  },
  {
    id: 13,
    title: '13. Khan’s Hollow Taunt',
    sourceStart: 92.0,
    sourceEnd: 101.8,
    targetDuration: 5.2,
    englishScript:
      'Scoffing the armored truck will get hopelessly lost without guides in steep mountain passes, the Khan hears Lu Xiao whisper he had better pray it does.',
    burmeseScript:
      'သံချပ်ကာကားကြီးက တောင်ကြားလမ်းမှာ မြင်းမပါ လမ်းပြမပါဘဲ လမ်းပျောက်နေလိမ့်မယ်လို့ ပြောရာမှာ လုရှောင်ကတော့ လမ်းပျောက်ပါစေလို့ပဲ ဆုတောင်းနေလိုက်လို့ ပြန်ပြောလိုက်ပါတယ်။',
  },
  {
    id: 14,
    title: '14. Checking Rifles & Gear',
    sourceStart: 101.8,
    sourceEnd: 110.4,
    targetDuration: 4.8,
    englishScript:
      'Returning to the riverbank armory, Lu Xiao unfolds the truck’s rear racks and locks fresh magazines into his automatic assault rifles.',
    burmeseScript:
      'မြစ်ကမ်းဘေးက သံချပ်ကာကားနောက်ခန်းကို ဖွင့်လိုက်တဲ့ လုရှောင်ဟာ ချေမှုန်းရေးရိုင်ဖယ်သေနတ်တွေနဲ့ ကျည်ကတ်တွေကို တစ်လက်ချင်း စစ်ဆေးတပ်ဆင်လိုက်ပါတယ်။',
  },
  {
    id: 15,
    title: '15. Testing Winch & Rope Hook',
    sourceStart: 110.4,
    sourceEnd: 120.2,
    targetDuration: 5.2,
    englishScript:
      'Securing his ballistic helmet and tactical rig, Lu Xiao pulls out the heavy bumper winch cable to confirm the electric motor runs smoothly.',
    burmeseScript:
      'ကျည်ကာဦးထုပ်နဲ့ စစ်သုံးပစ္စည်းတွေ ဝတ်ဆင်ပြီးနောက် ကားရှေ့က လျှပ်စစ်သံကြိုးဆွဲစက်နဲ့ ချိတ်တွေ ကောင်းမွန်ကြောင်းပါ သေချာစစ်ဆေးလိုက်ပါတယ်။',
  },
  {
    id: 16,
    title: '16. Last Grenade & Black Box',
    sourceStart: 120.2,
    sourceEnd: 128.5,
    targetDuration: 4.7,
    englishScript:
      'Checking four silver flashbangs beside his final fragmentation grenade, Lu Xiao grins as Lu Zhenyue nervously asks whether the black radio explodes.',
    burmeseScript:
      'အလင်းဗုံးလေးလုံးနဲ့ နောက်ဆုံးကျန်တဲ့ လက်ပစ်ဗုံးကို စစ်ဆေးနေတုန်း စစ်သူကြီးလုက စကားပြောစက်အမည်းလေးကိုပါ ပေါက်ကွဲတတ်လားဆိုပြီး လန့်မေးလိုက်ပါတယ်။',
  },
  {
    id: 17,
    title: '17. Voice Across Ten Miles',
    sourceStart: 128.5,
    sourceEnd: 136.5,
    targetDuration: 4.6,
    englishScript:
      'Pressing the side key, Lu Xiao explains the handheld radio carries speech ten miles away instantly without dispatch riders—leaving the giant stunned.',
    burmeseScript:
      'ဒီစက်က မပေါက်ကွဲဘဲ ခလုတ်နှိပ်ပြောရုံနဲ့ ဆယ်မိုင်အကွာအထိ စကားသံကြားရတယ်လို့ ရှင်းပြလိုက်ရာ စစ်သူကြီးလုပါ မျက်လုံးပြူးအံ့သြသွားပါတော့တယ်။',
  },
  {
    id: 18,
    title: '18. Whispering Into The Radio',
    sourceStart: 136.5,
    sourceEnd: 145.5,
    targetDuration: 4.9,
    englishScript:
      'Told to press before speaking and never shout, Lu Zhenyue sheepishly leans close whispering whether someone really lives inside the iron box.',
    burmeseScript:
      'ခလုတ်နှိပ်ပြောပြီး လွှတ်နားထောင်ဖို့ သင်ပေးလိုက်ရာ စစ်သူကြီးလုက စက်လေးနားကပ်ပြီး အထဲမှာ တကယ်လူရှိနေတာလားဆိုပြီး တိုးတိုးလေးမေးကြည့်လိုက်ပါတယ်။',
  },
  {
    id: 19,
    title: '19. Don’t Alert The Enemy',
    sourceStart: 145.5,
    sourceEnd: 154.5,
    targetDuration: 4.9,
    englishScript:
      'When Han’s clipped unit squawks back startling Lu Zhenyue, generals roar with laughter as Lu Xiao jokes yelling through it will tip off the Beirong.',
    burmeseScript:
      'တပ်မှူးဟန်ခါးကစက်ဆီ အသံဝင်သွားလို့ လန့်အော်မိတဲ့အခါ အဲဒီလောက်အော်နေရင် ဆယ်မိုင်အကွာက ရန်သူတွေပါ ကြားကုန်မယ်လို့ လုရှောင်က ပြန်နောက်လိုက်ပါတယ်။',
  },
  {
    id: 20,
    title: '20. Dispatching Pursuit Force',
    sourceStart: 154.5,
    sourceEnd: 162.5,
    targetDuration: 4.6,
    englishScript:
      'Distributing radios to Han Qingcang, Lu Zhenyue, and officers, the Emperor assigns 200 light cavalry to ride out while Wei holds the river.',
    burmeseScript:
      'စကားပြောစက်တွေ ဝေငှပြီးနောက် ဘုရင်ကြီးက ဟန်ချင်းချန်းနဲ့ စစ်သူကြီးလုတို့ကို မြင်းတပ်နှစ်ရာနဲ့အတူ လုရှောင်နောက်လိုက်ပြီး ပြည်သူတွေကို ကယ်တင်ဖို့ စေလွှတ်လိုက်ပါတယ်။',
  },
  {
    id: 21,
    title: '21. Deterred By Smoking Bluff',
    sourceStart: 162.5,
    sourceEnd: 170.5,
    targetDuration: 4.6,
    englishScript:
      'When Wei worries 200,000 foes may surge back once the truck departs, Lu Xiao points out the smoldering fortress bluff keeps them too afraid to gamble.',
    burmeseScript:
      'သံချပ်ကာကားထွက်သွားရင် ရန်သူနှစ်သိန်း ပြန်တိုက်မှာစိုးရိမ်ပေမယ့် မီးလောင်နေတဲ့စင်မြင့်ကြီးရှိနေသရွေ့ ရန်သူတွေ မစွန့်စားရဲကြဘူးလို့ လုရှောင်က ရှင်းပြလိုက်ပါတယ်။',
  },
  {
    id: 22,
    title: '22. Watching River All Night',
    sourceStart: 170.5,
    sourceEnd: 176.2,
    targetDuration: 4.2,
    englishScript:
      'Smiling calmly while the eavesdropping Khan scowls from the planks, the Emperor adds their royal hostage will keep him company all night.',
    burmeseScript:
      'ဒါ့အပြင် ဟဲလန်ခန်မင်းကြီးကိုယ်တိုင် တံတားပေါ်မှာ ဖမ်းထားတာမို့ ပြည်သူတွေပြန်မလာမချင်း တစ်ညလုံးအတူစောင့်ရမှာပေါ့လို့ ဘုရင်ကြီးက ခပ်ပြတ်ပြတ်ပြောလိုက်ပါတယ်။',
  },
  {
    id: 23,
    title: '23. Rescue Before Dawn',
    sourceStart: 176.2,
    sourceEnd: 180.4,
    targetDuration: 3.6,
    englishScript:
      'Gripping Lu Xiao’s shoulder to entrust over 3,000 innocent lives to him, the Emperor gets a fierce promise to bring everyone back before sunrise.',
    burmeseScript:
      'ဘုရင်ကြီးက ပြည်သူသုံးထောင်ကျော်ရဲ့ အသက်ကို လုရှောင်လက်ထဲအပ်လိုက်ရာ မိုးမလင်းခင် အားလုံးကို ဘေးကင်းစွာ ပြန်ကယ်လာမယ်လို့ ကတိပေးလိုက်ပါတယ်။',
  },
  {
    id: 24,
    title: '24. Racing Into Night Gorge',
    sourceStart: 180.4,
    sourceEnd: 184.8,
    targetDuration: 3.8,
    englishScript:
      'With headlights blazing ahead of 200 galloping riders, the armored truck races northwest toward Black Wolf Gorge where chained captives march by torchlight.',
    burmeseScript:
      'သံချပ်ကာကားကြီး ရှေ့ဆုံးကမောင်းထွက်သွားချိန် ညမှောင်မဲထဲ ဝံပုလွေနက်ချောက်ကြားအပြင်ဘက်မှာတော့ ပြည်သူသုံးထောင်ကျော်ဟာ ကြိုးတန်းချည်ပြီး ခေါ်ဆောင်ခံနေရပါတော့တယ်။',
  },
];
