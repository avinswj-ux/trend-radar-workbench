export type VisualScene = {
  scene?: number;
  visual?: string;
  narration?: string;
  onScreenText?: string;
  claim?: string;
  evidenceType?: string;
  evidenceRequirement?: string;
};

export type VisualType =
  | "PRODUCT_OVERVIEW"
  | "WORKFLOW"
  | "COMPARISON"
  | "FEATURE_GRID"
  | "RESULT"
  | "RISK";

export type VisualScenePlan = {
  scene: number;
  visualType: VisualType;
  functionFact: string;
  requiredObjects: string[];
  postLabels: string[];
  prompt: string;
};

function visualTypeFor(text: string): VisualType {
  if (/风险|限制|隐私|不适合|注意|不足|缺点|问题/.test(text)) return "RISK";
  if (/对比|以前|原来|真人|前后|vs|VS|区别/.test(text)) return "COMPARISON";
  if (/上传|输入|导入|点击|生成|转换|处理|步骤|流程/.test(text)) return "WORKFLOW";
  if (/支持|功能|包括|以及|配音|转写|有声书/.test(text)) return "FEATURE_GRID";
  if (/结果|效果|输出|完成|成功|波形/.test(text)) return "RESULT";
  return "PRODUCT_OVERVIEW";
}

function objectsFor(type: VisualType) {
  switch (type) {
    case "WORKFLOW":
      return ["清晰的输入对象", "处理中间状态", "明确的输出结果", "连接三者的方向箭头"];
    case "COMPARISON":
      return ["左右两个差异明显的对比区域", "对比前对象", "对比后对象", "可视化差异指标"];
    case "FEATURE_GRID":
      return ["四个有具体图标或内容的功能模块", "中心产品/任务对象", "模块之间的功能连接"];
    case "RESULT":
      return ["占据画面主体的结果对象", "处理前后的状态变化", "可辨识的完成反馈"];
    case "RISK":
      return ["风险与收益的对照关系", "警示符号", "明确的边界或限制状态"];
    default:
      return ["产品或设备主体", "核心功能符号", "输入与输出关系", "真实使用任务的物品线索"];
  }
}

function compact(value: string, limit = 220) {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function buildVisualScenePlan(
  title: string,
  scene: VisualScene,
  index: number,
  total: number,
): VisualScenePlan {
  const evidence = compact(
    [scene.claim, scene.evidenceRequirement, scene.visual, scene.narration, scene.onScreenText]
      .filter(Boolean)
      .join("；"),
  );
  const visualType = visualTypeFor(evidence);
  const requiredObjects = objectsFor(visualType);
  const label = compact(scene.onScreenText || title, 32);
  const postLabels = label ? [label] : [];
  const sceneNumber = Number(scene.scene) || index + 1;
  const prompt = `为中文 AI 应用内容生成一张 9:16 竖屏功能分镜。
应用主题：${title}
本幕序号：${sceneNumber}/${total}
经过内容分析后，本幕必须表达的具体功能事实：${evidence || title}
口播观点：${compact(scene.claim || scene.narration || title)}
证据类型：${compact(scene.evidenceType || "待判断", 40)}
必须找到或呈现的证据：${compact(scene.evidenceRequirement || scene.visual || "待验证")}
视觉类型：${visualType}
必须出现的视觉对象：${requiredObjects.join("、")}
构图要求：用具体对象和明确状态变化呈现“输入 → 应用处理 → 输出结果”，核心信息占画面至少 80%；任何卡片都必须包含图标、波形、文件缩略图、按钮状态或结果图形，禁止空白卡片、无意义几何图案、大面积纯色背景和只有科技氛围却看不出功能的画面。
真实性要求：证据画面优先于装饰画面；没有官方截图时不得仿制真实产品界面。不要生成真人、人脸、手部或人体。产品名称和准确标签由后期程序叠加，图片内部不要生成文字、Logo、水印或乱码，但必须为后期标签保留紧邻对应对象的小范围位置。
风格：真实产品可视化与高质量信息图结合，明亮、可信、现代，蓝紫色为主、暖黄色强调，细节丰富、层级清楚，不要空。`;
  return {
    scene: sceneNumber,
    visualType,
    functionFact: evidence || title,
    requiredObjects,
    postLabels,
    prompt,
  };
}
