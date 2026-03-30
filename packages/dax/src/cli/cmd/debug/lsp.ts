import { LSP } from "../../../lsp"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { Log } from "../../../util/log"
import { EOL } from "os"

export const LSPCommand = cmd({
  command: "lsp",
  describe: "LSP debugging utilities",
  builder: (yargs) =>
    yargs.command(StatusCommand).command(DiagnosticsCommand).command(SymbolsCommand).command(DocumentSymbolsCommand).demandCommand(),
  async handler() {},
})

const StatusCommand = cmd({
  command: "status",
  describe: "show enabled LSP servers and active client connections",
  async handler() {
    await bootstrap(process.cwd(), async () => {
      const state = await LSP.init()
      const connected = await LSP.status()
      process.stdout.write(
        JSON.stringify(
          {
            enabled: Object.values(state.servers)
              .map((server) => server.id)
              .sort((a, b) => a.localeCompare(b)),
            connected,
          },
          null,
          2,
        ) + EOL,
      )
    })
  },
})

const DiagnosticsCommand = cmd({
  command: "diagnostics <file>",
  describe: "get diagnostics for a file",
  builder: (yargs) => yargs.positional("file", { type: "string", demandOption: true }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      await LSP.touchFile(args.file, true)
      await Bun.sleep(1000)
      process.stdout.write(JSON.stringify(await LSP.diagnostics(), null, 2) + EOL)
    })
  },
})

export const SymbolsCommand = cmd({
  command: "symbols <query>",
  describe: "search workspace symbols",
  builder: (yargs) => yargs.positional("query", { type: "string", demandOption: true }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      using _ = Log.Default.time("symbols")
      const results = await LSP.workspaceSymbol(args.query)
      process.stdout.write(JSON.stringify(results, null, 2) + EOL)
    })
  },
})

export const DocumentSymbolsCommand = cmd({
  command: "document-symbols <uri>",
  describe: "get symbols from a document",
  builder: (yargs) => yargs.positional("uri", { type: "string", demandOption: true }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      using _ = Log.Default.time("document-symbols")
      const results = await LSP.documentSymbol(args.uri)
      process.stdout.write(JSON.stringify(results, null, 2) + EOL)
    })
  },
})
