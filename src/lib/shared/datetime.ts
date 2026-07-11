// No "server-only" here (unlike most of src/lib): this feeds
// <input type="datetime-local"> values, so client components need it too.

// Formats a Date as the local "YYYY-MM-DDTHH:mm" a datetime-local input wants.
export function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
