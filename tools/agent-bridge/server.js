import express from "express"
import dotenv from "dotenv"

dotenv.config()

const app = express()
app.use(express.json({ limit: "2mb" }))

const PORT = process.env.BRIDGE_PORT || 3030
const TOKEN = process.env.BRIDGE_TOKEN
const OPENAI = process.env.OPENAI_API_KEY

function auth(req, res, next) {
  if (req.headers["x-bridge-token"] !== TOKEN) {
    return res.status(401).json({ error: "unauthorized" })
  }
  next()
}

app.get("/health", (_, res) => {
  res.json({ ok: true, service: "agent-bridge" })
})

app.post("/ask-openai", auth, async (req, res) => {

  const { prompt } = req.body

  const r = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are a senior engineer assisting another AI agent. Be concise and actionable."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    }
  )

  const data = await r.json()

  res.json({
    ok: true,
    answer: data.choices?.[0]?.message?.content || ""
  })
})

app.listen(PORT, () => {
  console.log("Agent bridge running on port", PORT)
})
