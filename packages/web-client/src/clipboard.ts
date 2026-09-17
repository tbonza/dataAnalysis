/** Wraps the browser clipboard write in its own module so a click handler can be
 *  tested against a fake `navigator.clipboard` without rendering anything. */
export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
