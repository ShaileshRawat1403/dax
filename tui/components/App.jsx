/** @jsxImportSource react */
import React, { useState, useEffect, useCallback } from "react"
import { Box, Text, useInput } from "ink"
import TextInput from "ink-text-input"
import Spinner from "ink-spinner"

const COLORS = {
  primary: "#00D9FF",
  secondary: "#7B61FF",
  success: "#00E676",
  warning: "#FFB300",
  error: "#FF5252",
  text: "#E6EDF3",
  textDim: "#8B949E",
  border: "#30363D",
  accent: "#7C3AED",
}

const PROJECT_DIR = process.cwd()

async function loadSessions() {
  try {
    const { listSessions } = await import("../../core/session/store.js")
    return listSessions(PROJECT_DIR) || []
  } catch {
    return []
  }
}

async function loadConfig() {
  try {
    const { loadConfig: load } = await import("../../core/storage/config.js")
    return load(PROJECT_DIR)
  } catch {
    return { providers: [] }
  }
}

async function checkApiKey() {
  const config = await loadConfig()
  const providers = config.providers || []

  if (providers.length === 0) return false

  const first = providers[0]
  if (typeof first === "object" && first.id === "openai" && first.apiKey) return true
  if (process.env.OPENAI_API_KEY) return true

  return false
}

function formatDate(ts) {
  const date = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return "Today"
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday"
  return date.toLocaleDateString()
}

export default function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState("")
  const [status, setStatus] = useState("Initializing...")
  const [isLoading, setIsLoading] = useState(true)
  const [sessions, setSessions] = useState([])
  const [hasApiKey, setHasApiKey] = useState(false)
  const [view, setView] = useState("chat")
  const [selectedSession, setSelectedSession] = useState(null)
  const [configOpen, setConfigOpen] = useState(false)

  useEffect(() => {
    async function init() {
      const apiKey = await checkApiKey()
      setHasApiKey(apiKey)

      const sess = await loadSessions()
      setSessions(sess.slice(0, 15))

      setIsLoading(false)

      if (!apiKey) {
        setStatus("Setup required - Press P")
        setMessages([
          {
            id: "welcome",
            role: "assistant",
            content:
              "Welcome to DAX Classic! 🚀\n\nTo get started, you need to configure an AI provider.\n\n• Press P to open the provider configuration\n• Or set environment variables (OPENAI_API_KEY, etc.)",
          },
        ])
      } else {
        setStatus("Ready")
        setMessages([
          {
            id: "welcome",
            role: "assistant",
            content:
              "Welcome to DAX Classic! ✨\n\nI'm ready to help you build, debug, and automate your development workflow.\n\n• Describe what you need in plain language\n• I'll create a plan and execute it step by step",
          },
        ])
      }
    }
    init()
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || isLoading) return
    if (!hasApiKey) {
      setStatus("Please configure a provider first - Press P")
      return
    }

    const userMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input,
    }
    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)
    setStatus("Thinking...")

    try {
      const { streamSession } = await import("../../core/session/stream.js")

      let fullResponse = ""
      const assistantMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "",
      }
      setMessages((prev) => [...prev, assistantMessage])

      for await (const chunk of streamSession({ projectDir: PROJECT_DIR, prompt: input })) {
        if (chunk.type === "text") {
          fullResponse += chunk.delta
          setMessages((prev) => prev.map((m) => (m.id === assistantMessage.id ? { ...m, content: fullResponse } : m)))
        } else if (chunk.type === "done") {
          setStatus("Ready")
        }
      }
    } catch (error) {
      setStatus(`Error: ${error.message}`)
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "system",
          content: `Error: ${error.message}`,
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }, [input, isLoading, hasApiKey])

  useInput((inputChar, key) => {
    if (key.return) {
      handleSubmit()
    }
    if (key.ctrl && inputChar === "c") {
      process.exit(0)
    }
    if (key.ctrl && inputChar === "l") {
      setMessages([])
      setStatus("Cleared")
    }
    if (key.ctrl && inputChar === "r") {
      setStatus("Refreshing...")
      loadSessions().then((s) => {
        setSessions(s.slice(0, 15))
        setStatus("Ready")
      })
    }
    if (key.ctrl && inputChar === "p") {
      setConfigOpen(!configOpen)
      setView(configOpen ? "chat" : "config")
      setStatus(configOpen ? "Ready" : "Configure Provider")
    }
    if (key.escape && view === "config") {
      setConfigOpen(false)
      setView("chat")
      setStatus("Ready")
    }
  })

  if (view === "config") {
    return (
      <Box flexDirection="column" height={process.stdout.rows || 24}>
        <Box borderStyle="round" borderColor={COLORS.secondary} paddingX={1} paddingY={0}>
          <Text bold color={COLORS.secondary}>
            {" "}
            ◈ Provider Configuration{" "}
          </Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} padding={2}>
          <Text bold color={COLORS.text}>
            AI Providers
          </Text>
          <Text color={COLORS.textDim}>─────────────────────────────────────</Text>
          <Text color={COLORS.primary}>1. OpenAI</Text>
          <Text color={COLORS.textDim}> GPT-4, o1, GPT-4o</Text>
          <Text color={COLORS.textDim}> </Text>
          <Text color={COLORS.primary}>2. Anthropic</Text>
          <Text color={COLORS.textDim}> Claude 3.5, Claude 3 Opus</Text>
          <Text color={COLORS.textDim}> </Text>
          <Text color={COLORS.primary}>3. Google Gemini</Text>
          <Text color={COLORS.textDim}> Gemini 1.5 Pro, Flash</Text>
          <Text color={COLORS.textDim}> </Text>
          <Text color={COLORS.primary}>4. Ollama</Text>
          <Text color={COLORS.textDim}> Local models (Llama, etc.)</Text>
          <Text color={COLORS.textDim}>\n─────────────────────────────────────</Text>
          <Text bold color={COLORS.warning}>
            Quick Setup
          </Text>
          <Text color={COLORS.textDim}>Set environment variables:</Text>
          <Text color={COLORS.text}> export OPENAI_API_KEY="sk-..."</Text>
          <Text color={COLORS.text}> export ANTHROPIC_API_KEY="sk-ant-..."</Text>
          <Text color={COLORS.textDim}>\nOr edit: .dax/config.json</Text>
          <Text color={COLORS.textDim}>\n</Text>
          <Text bold color={COLORS.success}>
            Press ESC or P to return
          </Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" height={process.stdout.rows || 24}>
      <Box
        borderStyle="round"
        borderColor={COLORS.primary}
        paddingX={1}
        paddingY={0}
        flexDirection="row"
        justifyContent="space-between"
      >
        <Text bold color={COLORS.primary}>
          {" "}
          ◈ DAX <Text color={COLORS.secondary}>Classic</Text>{" "}
        </Text>
        <Text color={COLORS.textDim}>
          {isLoading ? <Spinner type="dots" /> : "●"} {status}
        </Text>
      </Box>

      <Box flexDirection="row" flexGrow={1} borderStyle="single" borderColor={COLORS.border}>
        <Box width={23} flexDirection="column" borderStyle="single" borderColor={COLORS.border}>
          <Box paddingX={1} paddingY={0} backgroundColor={COLORS.border}>
            <Text bold color={COLORS.text}>
              {" "}
              SESSIONS{" "}
            </Text>
          </Box>
          {sessions.length === 0 ? (
            <Box padding={1}>
              <Text color={COLORS.textDim} dimColor>
                No sessions yet
              </Text>
            </Box>
          ) : (
            sessions.map((s) => (
              <Box key={s.id} paddingX={1} paddingY={0}>
                <Text color={selectedSession === s.id ? COLORS.primary : COLORS.text} bold={selectedSession === s.id}>
                  {selectedSession === s.id ? "▶" : "▸"} {s.id.slice(0, 8)}
                </Text>
              </Box>
            ))
          )}
        </Box>

        <Box flexDirection="column" flexGrow={1} paddingX={1}>
          {messages.length === 0 ? (
            <Box flexGrow={1} justifyContent="center" alignItems="center">
              <Text color={COLORS.textDim}>Tell DAX what you need in plain language</Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              {messages.map((msg) => (
                <Box key={msg.id} paddingY={0}>
                  {msg.role === "user" ? (
                    <Text color={COLORS.primary} bold>
                      ▸ {msg.content}
                    </Text>
                  ) : msg.role === "assistant" ? (
                    <Text color={COLORS.success} wrap="wrap">
                      ◇ {msg.content}
                    </Text>
                  ) : (
                    <Text color={COLORS.error}>! {msg.content}</Text>
                  )}
                </Box>
              ))}
            </Box>
          )}

          <Box
            borderStyle="round"
            borderColor={isLoading ? COLORS.warning : COLORS.primary}
            paddingX={1}
            paddingY={0}
            marginTop={1}
          >
            <Text color={COLORS.primary}>{">"}</Text>
            <TextInput
              value={input}
              onChange={setInput}
              placeholder={isLoading ? "Thinking..." : "What would you like me to build?"}
            />
          </Box>
        </Box>
      </Box>

      <Box paddingX={1} flexDirection="row" justifyContent="space-between">
        <Text color={COLORS.textDim}>
          <Text color={COLORS.primary}>^C</Text> Quit <Text color={COLORS.primary}>^L</Text> Clear{" "}
          <Text color={COLORS.primary}>^R</Text> Refresh <Text color={COLORS.primary}>^P</Text> Providers
        </Text>
        <Text color={COLORS.textDim}>v1.0.0</Text>
      </Box>
    </Box>
  )
}
