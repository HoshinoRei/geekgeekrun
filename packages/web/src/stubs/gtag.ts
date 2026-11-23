// Analytics are optional and may fail in a container; the web build never reports.
export default async function gtag(..._args: unknown[]) {}

export function gtagPageView(..._args: unknown[]) {}

export function gtagApplicationError(..._args: unknown[]) {}