/** Window event that opens the command palette (dispatch it from any client component). */
export const OPEN_COMMAND_PALETTE_EVENT = "ll:open-command-palette";

export function openCommandPalette(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));
}
