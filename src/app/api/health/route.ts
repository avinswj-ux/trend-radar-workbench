import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ status: "ok", service: "trend-radar", version: "0.1.0" });
}
