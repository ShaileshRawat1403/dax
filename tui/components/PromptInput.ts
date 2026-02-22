import blessed from "blessed";

export function createPromptInput(screen: any, onSubmit: (value: string) => void) {
  const box = blessed.textbox({
    bottom: 0,
    left: 0,
    width: "100%",
    height: 3,
    style: {
      fg: "white",
      bg: "blue",
    },
    inputOnFocus: true,
    placeholder: "Type your prompt here...",
  });

  screen.append(box);

  box.on("submit", (value) => {
    if (value.trim()) {
      onSubmit(value);
      box.clearValue();
    }
    screen.render();
  });

  box.focus();

  return { box, clear: () => box.clearValue() };
}
