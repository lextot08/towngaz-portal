// Edge Function "recommend": asks Claude for the daily or weekly restock recommendation.
// The Recommendation page sends the stock and sales of each branch and size; Claude sends back
// a short overview and one short recommendation per branch (covering all its sizes).
// The Claude API key is the Supabase secret ANTHROPIC_API_KEY (it never reaches the browser).
// Deploy: Supabase Dashboard > Edge Functions > Deploy a new function > Via editor, name "recommend".
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

// the cheapest current Claude model ($0.10 / $0.50 per million input / output tokens)
const MODEL = "claude-haiku-5-5";

// the website calls this function from the browser
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

// The answer Claude must give (checked by the API: always valid JSON in this shape)
const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    branches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          branch: { type: "string" },
          recommendation: { type: "string" },
        },
        required: ["branch", "recommendation"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "branches"],
  additionalProperties: false,
};

const SYSTEM = `You are the inventory assistant of CJG Joseph and Norie Trading, an LPG (cooking gas) dealer in Batangas, Philippines, with several branches and one delivery truck. Each day the owner and the branch staff use your advice to decide which filled LPG cylinders to restock.

You get, for each branch and cylinder size: the filled tanks in stock now, the tanks sold today, the tanks sold in the last 7 days, and the low stock level set for that size.

Give:
- summary: 1 to 2 sentences for the owner: the most urgent branches first.
- branches: for every branch you were given (name written exactly as given), one recommendation of 1 to 2 short sentences covering all its sizes together: which sizes to restock and about how many tanks, and which are fine. Base the amounts on the average daily sales of the last 7 days: for a daily recommendation, enough for about 3 days plus the low stock level as a safety margin; for a weekly recommendation, about 7 days plus the low stock level. If every size is fine, say so in a few words.

A size is urgent when nothing is in stock, when the stock is at or below its low stock level, or when it will run out before the next restock at the current pace of sales. Keep the language simple; the staff are not technical. Branches restock filled tanks by exchanging their empty tanks.`;

type Row = {
  branch: string;
  size: string;
  in_stock: number;
  sold_today: number;
  sold_7_days: number;
  low_level: number;
};

const isCount = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 1_000_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "Use POST" });

  // ---- only approved admin and staff accounts can use it (it costs money per call) ----
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return reply(401, { error: "Please log in again." });
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!profile || profile.status !== "approved" || !["admin", "staff"].includes(profile.role)) {
    return reply(403, { error: "Only staff and the admin can make recommendations." });
  }

  // ---- the numbers sent by the page ----
  let body: { kind?: string; date?: string; rows?: Row[] };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "Invalid request" });
  }
  const kind = body.kind === "weekly" ? "weekly" : body.kind === "daily" ? "daily" : null;
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!kind) return reply(400, { error: "Choose daily or weekly" });
  if (rows.length === 0 || rows.length > 80) return reply(400, { error: "No stock data to check" });
  for (const r of rows) {
    const ok =
      typeof r.branch === "string" && r.branch.length <= 40 &&
      typeof r.size === "string" && r.size.length <= 12 &&
      isCount(r.in_stock) && isCount(r.sold_today) && isCount(r.sold_7_days) && isCount(r.low_level);
    if (!ok) return reply(400, { error: "Invalid stock data" });
  }

  const table = [
    "branch | size | in stock | sold today | sold last 7 days | low stock level",
    ...rows.map((r) =>
      `${r.branch} | ${r.size} | ${r.in_stock} | ${r.sold_today} | ${r.sold_7_days} | ${r.low_level}`
    ),
  ].join("\n");
  const today = typeof body.date === "string" ? body.date.slice(0, 10) : "";

  // ---- ask Claude ----
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: {
        effort: "low", // a short, routine analysis
        format: { type: "json_schema", schema: ANSWER_SCHEMA },
      },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Make the ${kind} restock recommendation${today ? ` for ${today}` : ""}.\n\n${table}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return reply(502, { error: "The recommendation could not be made. Please try again." });
    }
    if (response.stop_reason === "max_tokens") {
      return reply(502, { error: "The recommendation was too long. Choose one branch and try again." });
    }
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      return reply(502, { error: "The recommendation came back empty. Please try again." });
    }
    const answer = JSON.parse(text.text);
    return reply(200, { ...answer, kind, model: response.model, usage: response.usage });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return reply(500, { error: "The Claude API key is missing or wrong (Supabase secret ANTHROPIC_API_KEY)." });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return reply(429, { error: "Too many requests right now. Please wait a minute and try again." });
    }
    if (error instanceof Anthropic.APIError) {
      return reply(502, { error: `Claude API error ${error.status}: ${error.message}` });
    }
    return reply(500, { error: `Something went wrong: ${(error as Error).message}` });
  }
});
