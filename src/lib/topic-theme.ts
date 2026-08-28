export const topicThemes = ["DAILY_LIFE", "WORKPLACE", "LEARNING_GROWTH", "SMALL_BUSINESS", "FUN_PROJECT", "CREATOR_WORKFLOW", "VOICE_AVATAR", "VIDEO_CREATION", "PRODUCTIVITY", "TECH_FRONTIER"] as const;
export type TopicTheme = (typeof topicThemes)[number];

export const everydayTopicThemes: TopicTheme[] = ["DAILY_LIFE", "WORKPLACE", "LEARNING_GROWTH", "SMALL_BUSINESS", "FUN_PROJECT", "PRODUCTIVITY"];

export const topicThemeLabels: Record<TopicTheme, string> = {
  DAILY_LIFE: "日常生活",
  WORKPLACE: "职场办公",
  LEARNING_GROWTH: "学习成长",
  SMALL_BUSINESS: "小生意",
  TECH_FRONTIER: "技术前沿",
  FUN_PROJECT: "好玩项目",
  CREATOR_WORKFLOW: "创作工作流",
  VOICE_AVATAR: "声音 / 数字人",
  VIDEO_CREATION: "视频制作",
  PRODUCTIVITY: "效率工具",
};

export function inferTopicTheme(text: string): TopicTheme {
  const corpus = text.toLowerCase();
  // Academic titles frequently contain everyday words such as “study”, “teacher” or
  // “customer”; identify research signals before mapping concrete user scenarios.
  if (/arxiv|we propose|our experiments|benchmark|dataset|training data|reinforcement learning|embedding|architecture|framework:|towards |a comprehensive review|论文|训练方法|实验结果|基准测试/.test(corpus)) return "TECH_FRONTIER";
  if (/shopping|travel|recipe|meal|home|family|health|fitness|生活|旅行|购物|做饭|家庭|健身/.test(corpus)) return "DAILY_LIFE";
  if (/meeting|email|spreadsheet|document|presentation|customer service|resume|办公|会议|邮件|表格|文档|简历|客服/.test(corpus)) return "WORKPLACE";
  if (/learn|study|language|student|teacher|course|education|学习|教育|课程|英语|学生|老师/.test(corpus)) return "LEARNING_GROWTH";
  if (/small business|shop|sales|lead|marketing|commerce|invoice|小企业|门店|获客|营销|销售|电商/.test(corpus)) return "SMALL_BUSINESS";
  if (/voice|tts|speech|audio|变声|语音|配音|音色|数字人|avatar/.test(corpus)) return "VOICE_AVATAR";
  if (/video|image-to-video|text-to-video|剪辑|视频|影视|动效|montage/.test(corpus)) return "VIDEO_CREATION";
  if (/workflow|skill|automation|工作流|自动化|内容生产/.test(corpus)) return "CREATOR_WORKFLOW";
  if (/fun|play|demo|game|creative|好玩|创意|趣味/.test(corpus)) return "FUN_PROJECT";
  if (/productivity|efficient|效率|办公|协作/.test(corpus)) return "PRODUCTIVITY";
  return "TECH_FRONTIER";
}
