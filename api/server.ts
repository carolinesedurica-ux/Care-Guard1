import type { Request, Response } from "express";

export default async function handler(req: Request, res: Response) {
  try {
    const { default: app } = await import("../server");
    return app(req, res);
  } catch (err: any) {
    console.error("[api/server] init error:", err);
    res.status(500).json({ error: err?.message || String(err), stack: err?.stack });
  }
}
