/** Hands the browser a file to save (e.g. the order's .ics). Its own module so tests can replace it. */
export function saveFile(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
