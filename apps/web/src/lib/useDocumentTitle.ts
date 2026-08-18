import { useEffect } from "react";

const SUFFIX = "Visual Canvas";

/**
 * Sets the tab title for as long as the calling route is mounted.
 *
 * Every tab in the app read "Visual Canvas", which is exactly the case tab
 * titles exist to solve: three canvases open side by side were three
 * identical tabs. Pass `undefined` while the name is still loading and the
 * title stays put rather than flashing a placeholder.
 */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · ${SUFFIX}`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
