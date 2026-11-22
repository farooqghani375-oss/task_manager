/* Vercel serverless function: turns a course PDF into study sessions with Gemini.
   The API key lives in the GEMINI_API_KEY environment variable, never in the browser.

   Request  (POST JSON): { pdfBase64, granularity: "days" | "weeks", slots: [{ date: "YYYY-MM-DD", week: 1 }] }
   Response (JSON):      { course, sessions: [{ date, title, subject }] }  (dates are always from `slots`) */

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_BASE64_CHARS = 4_200_000;   // about 3 MB PDF; Vercel caps request bodies at about 4.5 MB
const MAX_SLOTS = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const RESPONSE_SCHEMA = {
    type: "OBJECT",
    properties: {
        course: { type: "STRING" },
        sessions: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    date: { type: "STRING" },
                    title: { type: "STRING" },
                    subject: { type: "STRING" },
                },
                required: ["date", "title"],
            },
        },
    },
    required: ["sessions"],
};

function buildPrompt(granularity, slots) {
    const unit = granularity === "weeks"
        ? "Each slot is one whole week, so each session title should name the topics to cover that week."
        : "Each slot is one study day, so each session title should name the single topic or section to study that day.";

    return [
        "You are planning a student's study schedule from the attached course PDF.",
        "Below is a list of study slots. Each slot has a date and a week number.",
        unit,
        "Go through the course material in order and give one session per slot, using the slot dates exactly as written.",
        "Use only as many slots as the material needs. Stop early once the course content is covered.",
        "Keep each title under 80 characters and write it in the same language as the course.",
        "Give the course name in \"course\" and a short subject name in \"subject\" for each session.",
        "Respond with JSON only.",
        "",
        "Slots:",
        JSON.stringify(slots),
    ].join("\n");
}

function sendError(res, status, message) {
    return res.status(status).json({ error: message });
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") return sendError(res, 405, "Use POST.");

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return sendError(res, 500, "Server is missing GEMINI_API_KEY. Add it in Vercel settings and redeploy.");

    let body;
    try {
        body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    } catch (err) {
        return sendError(res, 400, "Request body must be JSON.");
    }

    const { pdfBase64, granularity, slots } = body;

    if (typeof pdfBase64 !== "string" || !pdfBase64) return sendError(res, 400, "Upload a PDF file.");
    if (pdfBase64.length > MAX_BASE64_CHARS) return sendError(res, 413, "That PDF is too large. Use a file under 3 MB.");
    if (!pdfBase64.startsWith("JVBER")) return sendError(res, 400, "The uploaded file is not a PDF.");
    if (granularity !== "days" && granularity !== "weeks") return sendError(res, 400, "Choose days or weeks.");
    if (!Array.isArray(slots) || slots.length === 0 || slots.length > MAX_SLOTS) {
        return sendError(res, 400, "The study calendar is empty or too long.");
    }
    if (!slots.every((s) => s && DATE_RE.test(s.date) && Number.isInteger(s.week))) {
        return sendError(res, 400, "Study calendar entries must have a date and a week number.");
    }

    const allowedDates = new Set(slots.map((s) => s.date));

    let upstream;
    try {
        upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
                contents: [{
                    role: "user",
                    parts: [
                        { inline_data: { mime_type: "application/pdf", data: pdfBase64 } },
                        { text: buildPrompt(granularity, slots) },
                    ],
                }],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: RESPONSE_SCHEMA,
                    temperature: 0.2,
                },
            }),
        });
    } catch (err) {
        return sendError(res, 502, "Could not reach the AI service. Check the internet connection and try again.");
    }

    if (!upstream.ok) {
        const detail = await upstream.text().catch(() => "");
        console.error("Gemini error", upstream.status, detail.slice(0, 500));
        const message = upstream.status === 429
            ? "The AI service is busy or the free quota is used up. Try again later."
            : `The AI service returned an error (${upstream.status}).`;
        return sendError(res, 502, message);
    }

    let parsed;
    try {
        const data = await upstream.json();
        const candidate = data.candidates && data.candidates[0];
        const text = candidate && candidate.content && candidate.content.parts
            ? candidate.content.parts.map((p) => p.text || "").join("")
            : "";
        parsed = JSON.parse(text);
    } catch (err) {
        return sendError(res, 502, "The AI did not return a readable plan. Try again, or use a smaller PDF.");
    }

    // Keep only sessions on dates we offered, one per date, with trimmed text
    const seen = new Set();
    const sessions = [];
    for (const s of Array.isArray(parsed.sessions) ? parsed.sessions : []) {
        if (!s || !allowedDates.has(s.date) || seen.has(s.date)) continue;
        seen.add(s.date);
        sessions.push({
            date: s.date,
            title: String(s.title || "").trim().slice(0, 120) || "Study session",
            subject: String(s.subject || "").trim().slice(0, 40),
        });
    }
    sessions.sort((a, b) => a.date.localeCompare(b.date));

    return res.status(200).json({
        course: String(parsed.course || "").trim().slice(0, 80),
        sessions,
    });
};
