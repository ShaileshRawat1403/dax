import {
  addNote,
  listNotes,
  searchNotes,
  removeNote,
  filterByTags,
  exportNotes,
  NewNote,
} from "../../core/pm";
import { readFileSync } from "node:fs";

interface ParsedMemoryArgs {
  tags: string[];
  author: string | null;
  source: string | null;
  text: string[];
}

function parseArgs(args: string[]): ParsedMemoryArgs {
  const out: ParsedMemoryArgs = {
    tags: [],
    author: null,
    source: null,
    text: [],
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--tags=")) {
      out.tags = a.split("=")[1].split(",").filter(Boolean);
    } else if (a.startsWith("--author=")) {
      out.author = a.split("=")[1];
    } else if (a.startsWith("--source=")) {
      out.source = a.split("=")[1];
    } else {
      out.text.push(a);
    }
  }
  return out;
}

export function runMemory(args: string[], cwd: string): void {
  const sub = args[0];
  if (!sub || sub === "list") {
    const notes = listNotes(cwd);
    console.log(JSON.stringify(notes, null, 2));
    return;
  }
  if (sub === "add") {
    const parsed = parseArgs(args.slice(1));
    const text = parsed.text.join(" ");
    if (!text) {
      console.error(
        "Usage: dax memory add <text> [--tags=a,b] [--author=name] [--source=user|system|agent]",
      );
      process.exit(1);
    }
    const note: NewNote = {
      text,
      tags: parsed.tags,
      author: parsed.author,
      source: parsed.source || "user",
    };
    const added = addNote(cwd, note);
    console.log(JSON.stringify(added, null, 2));
    return;
  }
  if (sub === "search") {
    const query = args.slice(1).join(" ");
    if (!query) {
      console.error("Usage: dax memory search <query>");
      process.exit(1);
    }
    const notes = searchNotes(cwd, query);
    console.log(JSON.stringify(notes, null, 2));
    return;
  }
  if (sub === "tags") {
    const tags = args
      .slice(1)
      .join(" ")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (!tags.length) {
      console.error("Usage: dax memory tags tag1,tag2");
      process.exit(1);
    }
    const notes = filterByTags(cwd, tags);
    console.log(JSON.stringify(notes, null, 2));
    return;
  }
  if (sub === "remove") {
    const id = args[1];
    if (!id) {
      console.error("Usage: dax memory remove <id>");
      process.exit(1);
    }
    const next = removeNote(cwd, id);
    console.log(JSON.stringify(next, null, 2));
    return;
  }
  if (sub === "export") {
    const data = exportNotes(cwd);
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (sub === "import") {
    const path = args[1];
    if (!path) {
      console.error("Usage: dax memory import <file.json>");
      process.exit(1);
    }
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (!data || !Array.isArray(data.notes)) {
      console.error("Invalid memory file: expected { notes: [...] }");
      process.exit(1);
    }
    for (const n of data.notes) {
      addNote(cwd, {
        text: n.text,
        tags: n.tags || [],
        author: n.author,
        source: n.source,
      });
    }
    console.log(JSON.stringify(listNotes(cwd), null, 2));
    return;
  }
  console.error(
    "Usage: dax memory [list] | add <text> | search <query> | tags <tag1,tag2> | remove <id> | export | import <file.json>",
  );
  process.exit(1);
}
