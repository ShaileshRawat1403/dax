import blessed from "blessed";
import { listSessions } from "../../core/session/store";

export function createHomeView(screen: any) {
  const box = blessed.box({
    top: "center",
    left: "center",
    width: 60,
    height: "80%",
    style: {
      fg: "white",
    },
    tags: true,
    hidden: true,
  });

  screen.append(box);

  function show() {
    const sessions = listSessions(process.cwd()).slice(0, 10);
    let content = "{bold}{cyan}DAX - Deterministic AI Execution{/cyan}{/bold}\n\n";
    
    content += "{bold}Recent Sessions:{/bold}\n\n";
    
    if (sessions.length === 0) {
      content += "{italic}No sessions yet. Start a new session below.{/italic}\n\n";
    } else {
      for (const session of sessions) {
        content += `• ${session.id.slice(0, 8)}... | ${session.status} | ${session.ts.slice(0, 10)}\n`;
      }
      content += "\n";
    }

    content += "{bold}Commands:{/bold}\n";
    content += "  [n] New Session\n";
    content += "  [q] Quit\n";

    box.setContent(content);
    box.show();
    screen.render();
  }

  function hide() {
    box.hide();
    screen.render();
  }

  return { box, show, hide };
}
