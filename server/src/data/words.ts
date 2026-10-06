// English word of the day for children: common primary-school words with part of speech,
// British IPA, Chinese meaning and an example sentence (written for this project). Parents
// can add their own list on the modes page: "word|/音标/|词性|释义|例句|例句翻译" (音标 optional).

export interface Word { word: string; ipa: string; pos: string; zh: string; example: string; exampleZh: string }

const W = (s: string): Word => {
  const [word, pos, zh, example, exampleZh] = s.split("|");
  return { word, ipa: IPA[word] ?? "", pos, zh, example, exampleZh };
};

/** British IPA (as in Chinese school textbooks) for the built-in words. */
const IPA: Record<string, string> = {
  apple: "ˈæpl", book: "bʊk", happy: "ˈhæpi", friend: "frend", water: "ˈwɔːtə", school: "skuːl",
  family: "ˈfæməli", beautiful: "ˈbjuːtɪfl", run: "rʌn", read: "riːd", write: "raɪt", listen: "ˈlɪsn",
  morning: "ˈmɔːnɪŋ", weather: "ˈweðə", rain: "reɪn", sun: "sʌn", moon: "muːn", star: "stɑː",
  tree: "triː", flower: "ˈflaʊə", animal: "ˈænɪml", bird: "bɜːd", fish: "fɪʃ", cat: "kæt",
  dog: "dɒɡ", red: "red", blue: "bluː", green: "ɡriːn", yellow: "ˈjeləʊ", big: "bɪɡ",
  small: "smɔːl", tall: "tɔːl", short: "ʃɔːt", hot: "hɒt", cold: "kəʊld", hungry: "ˈhʌŋɡri",
  tired: "ˈtaɪəd", kind: "kaɪnd", brave: "breɪv", careful: "ˈkeəfl", quiet: "ˈkwaɪət", clean: "kliːn",
  help: "help", play: "pleɪ", swim: "swɪm", sing: "sɪŋ", dance: "dɑːns", draw: "drɔː",
  jump: "dʒʌmp", walk: "wɔːk", sleep: "sliːp", open: "ˈəʊpən", close: "kləʊz", like: "laɪk",
  want: "wɒnt", know: "nəʊ", think: "θɪŋk", remember: "rɪˈmembə", forget: "fəˈɡet", learn: "lɜːn",
  teach: "tiːtʃ", answer: "ˈɑːnsə", question: "ˈkwestʃən", teacher: "ˈtiːtʃə", student: "ˈstjuːdnt",
  classroom: "ˈklɑːsruːm", homework: "ˈhəʊmwɜːk", pencil: "ˈpensl", ruler: "ˈruːlə", bag: "bæɡ",
  desk: "desk", chair: "tʃeə", window: "ˈwɪndəʊ", door: "dɔː", house: "haʊs", kitchen: "ˈkɪtʃɪn",
  breakfast: "ˈbrekfəst", lunch: "lʌntʃ", dinner: "ˈdɪnə", rice: "raɪs", milk: "mɪlk", egg: "eɡ",
  bread: "bred", vegetable: "ˈvedʒtəbl", fruit: "fruːt", day: "deɪ", week: "wiːk", month: "mʌnθ",
  year: "jɪə", today: "təˈdeɪ", tomorrow: "təˈmɒrəʊ", always: "ˈɔːlweɪz", never: "ˈnevə",
  together: "təˈɡeðə", early: "ˈɜːli", late: "leɪt", favorite: "ˈfeɪvərɪt", different: "ˈdɪfrənt",
  important: "ɪmˈpɔːtnt", dream: "driːm", smile: "smaɪl", thank: "θæŋk", sorry: "ˈsɒri",
  welcome: "ˈwelkəm", share: "ʃeə", try: "traɪ",
};


export const WORDS: Word[] = [
  "apple|n.|苹果|I eat an apple every day.|我每天吃一个苹果。",
  "book|n.|书|This book is about animals.|这本书是关于动物的。",
  "happy|adj.|快乐的|She is happy to see her friends.|她见到朋友很开心。",
  "friend|n.|朋友|Tom is my best friend.|汤姆是我最好的朋友。",
  "water|n.|水|Please drink more water.|请多喝水。",
  "school|n.|学校|We go to school at seven thirty.|我们七点半去上学。",
  "family|n.|家庭|There are four people in my family.|我家有四口人。",
  "beautiful|adj.|美丽的|The flowers are beautiful.|这些花很美。",
  "run|v.|跑|The dog can run very fast.|这只狗跑得很快。",
  "read|v.|读|I like to read before bed.|我喜欢睡前读书。",
  "write|v.|写|Can you write your name?|你会写自己的名字吗？",
  "listen|v.|听|Listen to the teacher, please.|请听老师讲。",
  "morning|n.|早晨|Good morning, everyone!|大家早上好！",
  "weather|n.|天气|The weather is sunny today.|今天天气晴朗。",
  "rain|n./v.|雨；下雨|Take an umbrella. It may rain.|带把伞，可能会下雨。",
  "sun|n.|太阳|The sun rises in the east.|太阳从东方升起。",
  "moon|n.|月亮|The moon is round tonight.|今晚的月亮是圆的。",
  "star|n.|星星|I can see many stars in the sky.|我能看到天上有很多星星。",
  "tree|n.|树|There is a bird in the tree.|树上有一只鸟。",
  "flower|n.|花|She gave her mother a flower.|她送给妈妈一朵花。",
  "animal|n.|动物|The panda is my favorite animal.|熊猫是我最喜欢的动物。",
  "bird|n.|鸟|The bird is singing.|小鸟在唱歌。",
  "fish|n.|鱼|There are fish in the river.|河里有鱼。",
  "cat|n.|猫|My cat sleeps all day.|我的猫整天睡觉。",
  "dog|n.|狗|The dog is waiting at the door.|狗在门口等着。",
  "red|adj.|红色的|I have a red bag.|我有一个红色的书包。",
  "blue|adj.|蓝色的|The sky is blue.|天空是蓝色的。",
  "green|adj.|绿色的|Leaves are green in summer.|夏天树叶是绿色的。",
  "yellow|adj.|黄色的|Bananas are yellow.|香蕉是黄色的。",
  "big|adj.|大的|An elephant is very big.|大象非常大。",
  "small|adj.|小的|The mouse is small.|老鼠很小。",
  "tall|adj.|高的|My father is tall.|我爸爸个子很高。",
  "short|adj.|矮的；短的|This pencil is too short.|这支铅笔太短了。",
  "hot|adj.|热的|It is hot in July.|七月天气很热。",
  "cold|adj.|冷的|Wear a coat. It is cold outside.|穿上外套，外面很冷。",
  "hungry|adj.|饿的|I am hungry. Let's have lunch.|我饿了，我们吃午饭吧。",
  "tired|adj.|累的|He is tired after the game.|比赛后他很累。",
  "kind|adj.|友好的；善良的|Be kind to others.|要善待他人。",
  "brave|adj.|勇敢的|The brave boy helped the cat.|勇敢的男孩帮助了小猫。",
  "careful|adj.|小心的|Be careful when you cross the road.|过马路时要小心。",
  "quiet|adj.|安静的|Please be quiet in the library.|在图书馆请保持安静。",
  "clean|adj./v.|干净的；打扫|Let's clean our room.|我们来打扫房间吧。",
  "help|v.|帮助|Can I help you?|需要我帮忙吗？",
  "play|v.|玩；弹奏|We play football after school.|我们放学后踢足球。",
  "swim|v.|游泳|I learn to swim in summer.|我夏天学游泳。",
  "sing|v.|唱歌|Let's sing a song together.|我们一起唱首歌吧。",
  "dance|v.|跳舞|She likes to dance.|她喜欢跳舞。",
  "draw|v.|画画|He can draw a horse.|他会画马。",
  "jump|v.|跳|The rabbit can jump high.|兔子能跳得很高。",
  "walk|v.|走路|I walk to school with my sister.|我和姐姐走路去上学。",
  "sleep|v.|睡觉|Children need to sleep early.|孩子们需要早睡。",
  "open|v.|打开|Open your book to page ten.|把书翻到第十页。",
  "close|v.|关上|Please close the window.|请关上窗户。",
  "like|v.|喜欢|I like ice cream.|我喜欢冰淇淋。",
  "want|v.|想要|I want a new bike.|我想要一辆新自行车。",
  "know|v.|知道|Do you know the answer?|你知道答案吗？",
  "think|v.|想；认为|I think it will rain.|我觉得会下雨。",
  "remember|v.|记得|Remember to bring your homework.|记得带上作业。",
  "forget|v.|忘记|Don't forget your keys.|别忘了你的钥匙。",
  "learn|v.|学习|We learn something new every day.|我们每天都学新东西。",
  "teach|v.|教|My mother teaches me to cook.|妈妈教我做饭。",
  "answer|n./v.|答案；回答|Raise your hand to answer.|举手回答问题。",
  "question|n.|问题|May I ask a question?|我可以问个问题吗？",
  "teacher|n.|老师|Our teacher is very kind.|我们的老师非常和蔼。",
  "student|n.|学生|There are forty students in my class.|我们班有四十名学生。",
  "classroom|n.|教室|Our classroom is clean and bright.|我们的教室干净明亮。",
  "homework|n.|家庭作业|I finish my homework before dinner.|我晚饭前完成作业。",
  "pencil|n.|铅笔|May I use your pencil?|我可以用一下你的铅笔吗？",
  "ruler|n.|尺子|I need a ruler to draw a line.|我需要一把尺子画线。",
  "bag|n.|包；书包|My bag is heavy today.|我今天的书包很重。",
  "desk|n.|书桌|The book is on the desk.|书在书桌上。",
  "chair|n.|椅子|Sit on the chair, please.|请坐在椅子上。",
  "window|n.|窗户|Look out of the window.|看窗外。",
  "door|n.|门|Someone is at the door.|有人在门口。",
  "house|n.|房子|They live in a big house.|他们住在一座大房子里。",
  "kitchen|n.|厨房|Mom is cooking in the kitchen.|妈妈在厨房做饭。",
  "breakfast|n.|早餐|Don't skip breakfast.|不要不吃早餐。",
  "lunch|n.|午餐|We have lunch at twelve.|我们十二点吃午饭。",
  "dinner|n.|晚餐|Dinner is ready!|晚饭做好了！",
  "rice|n.|米饭|I eat rice with vegetables.|我吃米饭配蔬菜。",
  "milk|n.|牛奶|A glass of milk, please.|请给我一杯牛奶。",
  "egg|n.|鸡蛋|I had an egg for breakfast.|我早餐吃了一个鸡蛋。",
  "bread|n.|面包|The bread smells good.|面包闻起来很香。",
  "vegetable|n.|蔬菜|Vegetables are good for you.|蔬菜对你有好处。",
  "fruit|n.|水果|What fruit do you like?|你喜欢什么水果？",
  "day|n.|天；白天|Have a nice day!|祝你今天愉快！",
  "week|n.|星期；周|There are seven days in a week.|一周有七天。",
  "month|n.|月|My birthday is next month.|我的生日在下个月。",
  "year|n.|年|Happy New Year!|新年快乐！",
  "today|adv.|今天|What day is it today?|今天星期几？",
  "tomorrow|adv.|明天|See you tomorrow!|明天见！",
  "always|adv.|总是|She always smiles.|她总是面带微笑。",
  "never|adv.|从不|Never give up!|永不放弃！",
  "together|adv.|一起|Let's play together.|我们一起玩吧。",
  "early|adj./adv.|早的；早|I get up early on Monday.|我周一起得很早。",
  "late|adj./adv.|迟的；晚|Don't be late for school.|上学不要迟到。",
  "favorite|adj.|最喜欢的|Blue is my favorite color.|蓝色是我最喜欢的颜色。",
  "different|adj.|不同的|We are different, but we are friends.|我们不一样，但我们是朋友。",
  "important|adj.|重要的|Sleep is important for children.|睡眠对孩子很重要。",
  "dream|n./v.|梦想；做梦|My dream is to be a doctor.|我的梦想是成为一名医生。",
  "smile|n./v.|微笑|Her smile makes me happy.|她的微笑让我很开心。",
  "thank|v.|感谢|Thank you for your help.|谢谢你的帮助。",
  "sorry|adj.|抱歉的|I am sorry I am late.|对不起，我迟到了。",
  "welcome|adj./v.|受欢迎的；欢迎|You are welcome!|不客气！",
  "share|v.|分享|Let's share the cake.|我们分享这块蛋糕吧。",
  "try|v.|尝试|Try again. You can do it!|再试一次，你能行的！",
].map(W);

/** Parses the parents' list ("word|/音标/|词性|释义|例句|例句翻译"); bad lines are skipped. */
export function parseWords(text: string): Word[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("|").map((x) => x.trim()))
    .filter((p) => p[0])
    .map((p) => {
      // an optional second field in slashes or brackets is the phonetic transcription
      const ipa = /^[/[].*[/\]]$/.test(p[1] ?? "") ? p.splice(1, 1)[0].slice(1, -1) : (IPA[p[0].toLowerCase()] ?? "");
      const [word, pos = "", zh = "", example = "", exampleZh = ""] = p;
      return { word, ipa, pos, zh, example, exampleZh };
    });
}

/** Index of the day's word: walks the list one per day (local date). */
export function wordIndex(date: Date, n: number): number {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
  return ((day % n) + n) % n;
}
