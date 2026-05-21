import type { IncomingMessage, ServerResponse } from "node:http";
import { context, reddit, redis } from "@devvit/web/server";
import type {
  PartialJsonValue,
  TriggerResponse,
  UiResponse,
} from "@devvit/web/shared";
import {
  ApiEndpoint,
  type DecrementRequest,
  type DecrementResponse,
  type IncrementRequest,
  type IncrementResponse,
  type InitResponse,
} from "../shared/api.ts";
import { once } from "node:events";

export async function serverOnRequest(
  req: IncomingMessage,
  rsp: ServerResponse,
): Promise<void> {
  try {
    await onRequest(req, rsp);
  } catch (err) {
    const msg = `server error; ${err instanceof Error ? err.stack : err}`;
    console.error(msg);
    writeJSON<ErrorResponse>(500, { error: msg, status: 500 }, rsp);
  }
}

async function onRequest(
  req: IncomingMessage,
  rsp: ServerResponse,
): Promise<void> {
  const url = req.url;

  if (!url || url === "/") {
    writeJSON<ErrorResponse>(404, { error: "not found", status: 404 }, rsp);
    return;
  }

  // ── MLB Stats API proxy ─────────────────────────────────────────────────
  const urlObj = new URL(url, "http://localhost");
  const pathname = urlObj.pathname;
  if (pathname === "/api/schedule") {
    await onSchedule(urlObj, rsp);
    return;
  }
  if (pathname.startsWith("/api/game/")) {
    await onGame(pathname.slice("/api/game/".length), rsp);
    return;
  }
  if (pathname.startsWith("/api/logo/")) {
    const teamId = pathname.slice("/api/logo/".length).replace(/\.svg$/, "");
    await onLogo(teamId, rsp);
    return;
  }
  if (pathname.startsWith("/api/headshot/")) {
    const playerId = pathname.slice("/api/headshot/".length).replace(/\.\w+$/, "");
    await onHeadshot(playerId, rsp);
    return;
  }

  const endpoint = url as ApiEndpoint;

  let body: ApiResponse | UiResponse | ErrorResponse;
  switch (endpoint) {
    case ApiEndpoint.Init:
      body = await onInit();
      break;
    case ApiEndpoint.Increment:
      body = await onIncrement(req);
      break;
    case ApiEndpoint.Decrement:
      body = await onDecrement(req);
      break;
    case ApiEndpoint.OnPostCreate:
      body = await onMenuNewPost();
      break;
    case ApiEndpoint.OnAppInstall:
      body = await onAppInstall();
      break;
    default:
      endpoint satisfies never;
      body = { error: "not found", status: 404 };
      break;
  }

  writeJSON<PartialJsonValue>("status" in body ? body.status : 200, body, rsp);
}

type ApiResponse = InitResponse | IncrementResponse | DecrementResponse;

type ErrorResponse = {
  error: string;
  status: number;
};

function getPostId(): string {
  if (!context.postId) {
    throw Error("no post ID");
  }
  return context.postId;
}

function getPostCountKey(postId: string): string {
  return `count:${postId}`;
}

async function onInit(): Promise<InitResponse> {
  const postId = getPostId();
  const count = Number((await redis.get(getPostCountKey(postId))) ?? 0);
  return {
    type: "init",
    postId,
    count,
    username: context.username ?? "user",
  };
}

async function onIncrement(req: IncomingMessage): Promise<IncrementResponse> {
  const postId = getPostId();
  const { amount } = await readJSON<IncrementRequest>(req).catch(() => ({
    amount: 1,
  }));
  const incrementBy = Number.isFinite(amount) ? amount : 1;
  const count = await redis.incrBy(getPostCountKey(postId), incrementBy);
  return {
    type: "increment",
    postId,
    count,
  };
}

async function onDecrement(req: IncomingMessage): Promise<DecrementResponse> {
  const postId = getPostId();
  const { amount } = await readJSON<DecrementRequest>(req).catch(() => ({
    amount: 1,
  }));
  const parsedAmount = typeof amount === "number" ? amount : Number(amount);
  const decrementBy = Number.isFinite(parsedAmount) ? parsedAmount : 1;
  const count = Number(
    await redis.incrBy(getPostCountKey(postId), -decrementBy),
  );
  return {
    type: "decrement",
    postId,
    count,
  };
}

async function onMenuNewPost(): Promise<UiResponse> {
  const post = await reddit.submitCustomPost({ title: context.appName });
  return {
    showToast: { text: `Post ${post.id} created.`, appearance: "success" },
    navigateTo: post.url,
  };
}

async function onAppInstall(): Promise<TriggerResponse> {
  await reddit.submitCustomPost({
    title: "mlb-scores",
  });

  return {};
}

function writeJSON<T extends PartialJsonValue>(
  status: number,
  json: Readonly<T>,
  rsp: ServerResponse,
): void {
  const body = JSON.stringify(json);
  const len = Buffer.byteLength(body);
  rsp.writeHead(status, {
    "Content-Length": len,
    "Content-Type": "application/json",
  });
  rsp.end(body);
}

async function readJSON<T>(req: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  await once(req, "end");
  return JSON.parse(`${Buffer.concat(chunks)}`);
}

async function onSchedule(
  urlObj: URL,
  rsp: ServerResponse,
): Promise<void> {
  const date = urlObj.searchParams.get("date");
  if (!date) {
    writeJSON<ErrorResponse>(
      400,
      { error: "Missing date param", status: 400 },
      rsp,
    );
    return;
  }
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`,
    );
    const data = (await r.json()) as PartialJsonValue;
    writeJSON<PartialJsonValue>(200, data, rsp);
  } catch (e) {
    writeJSON<ErrorResponse>(500, { error: String(e), status: 500 }, rsp);
  }
}

async function onGame(pk: string, rsp: ServerResponse): Promise<void> {
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1.1/game/${pk}/feed/live`,
    );
    const data = (await r.json()) as PartialJsonValue;
    writeJSON<PartialJsonValue>(200, data, rsp);
  } catch (e) {
    writeJSON<ErrorResponse>(500, { error: String(e), status: 500 }, rsp);
  }
}

async function onLogo(teamId: string, rsp: ServerResponse): Promise<void> {
  if (!/^\d+$/.test(teamId)) {
    writeJSON<ErrorResponse>(
      400,
      { error: "Invalid team ID", status: 400 },
      rsp,
    );
    return;
  }
  try {
    const r = await fetch(
      `https://www.mlbstatic.com/team-logos/${teamId}.svg`,
    );
    if (!r.ok) {
      console.error(`Logo upstream ${teamId}: ${r.status} ${r.statusText}`);
      writeJSON<ErrorResponse>(
        404,
        { error: `Upstream ${r.status}`, status: 404 },
        rsp,
      );
      return;
    }
    const svg = await r.text();
    writeJSON<PartialJsonValue>(200, { svg } as PartialJsonValue, rsp);
  } catch (e) {
    console.error(`onLogo error for ${teamId}:`, e);
    writeJSON<ErrorResponse>(500, { error: String(e), status: 500 }, rsp);
  }
}

async function onHeadshot(playerId: string, rsp: ServerResponse): Promise<void> {
  if (!/^\d+$/.test(playerId)) {
    writeJSON<ErrorResponse>(
      400,
      { error: "Invalid player ID", status: 400 },
      rsp,
    );
    return;
  }
  try {
    const url =
      `https://img.mlbstatic.com/mlb-photos/image/upload/` +
      `d_people:generic:headshot:67:current.png/w_213,q_auto:best/` +
      `v1/people/${playerId}/headshot/67/current`;
    const r = await fetch(url);
    if (!r.ok) {
      console.error(`Headshot upstream ${playerId}: ${r.status}`);
      writeJSON<ErrorResponse>(
        404,
        { error: `Upstream ${r.status}`, status: 404 },
        rsp,
      );
      return;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const mime = r.headers.get("content-type") || "image/png";
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    writeJSON<PartialJsonValue>(200, { src: dataUrl } as PartialJsonValue, rsp);
  } catch (e) {
    console.error(`onHeadshot error for ${playerId}:`, e);
    writeJSON<ErrorResponse>(500, { error: String(e), status: 500 }, rsp);
  }
}