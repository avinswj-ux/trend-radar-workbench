import { NextResponse } from "next/server";
import { generateNarrationClips } from "@/lib/narration-generation";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const force = new URL(request.url).searchParams.get("force") === "1";
    return NextResponse.json({ clips: await generateNarrationClips(id, { force }) });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "旁白生成失败";
    const status = error === "内容稿不存在" ? 404 : 422;
    return NextResponse.json({ error }, { status });
  }
}
