import { useEffect } from "react";

/** BrowserRouter has no data-router blocker. Guard links and browser history explicitly. */
export function useUnsavedNavigation(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const prompt = "This draft has unsaved or unconfirmed changes. Leave and discard local edits?";
    const startingIndex = Number(window.history.state?.idx ?? 0);
    let restoring = false;
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (
        !link ||
        link.target === "_blank" ||
        link.hasAttribute("download") ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      if (link.href === window.location.href) return;
      if (!window.confirm(prompt)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const pop = (event: PopStateEvent) => {
      if (restoring) {
        restoring = false;
        event.stopImmediatePropagation();
        return;
      }
      const destination = Number(event.state?.idx ?? startingIndex);
      if (destination === startingIndex || window.confirm(prompt)) return;
      event.stopImmediatePropagation();
      restoring = true;
      window.history.go(startingIndex - destination);
    };
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", pop, true);
    return () => {
      document.removeEventListener("click", click, true);
      window.removeEventListener("popstate", pop, true);
    };
  }, [dirty]);
}
