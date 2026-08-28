import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runPrecheckAndAutoAdopt } from "@/lib/publish-precheck-apply";

const schema = z.object({ commercial: z.boolean().default(false), industry: z.enum(["general", "medical", "finance"]).default("general") });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const input = schema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const { id } = await context.params;
  try {
    const draft = await runPrecheckAndAutoAdopt(id, input.data);
    if (!draft) return NextResponse.json({ error: "稿件不存在" }, { status: 404 });
    return NextResponse.json(draft, { status: 201 });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "发布前审查失败" }, { status: 500 });
  }
}
