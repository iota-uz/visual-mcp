import { renderReferenceScreen } from "./reference-templates.js";

function route() {
  const [owner = "culprit", id = "scene"] = location.hash.replace(/^#\//, "").split("/");
  return { owner, id };
}

function ready(state = "ready", detail = "") {
  parent.postMessage({ type: "visual-canvas:readiness", state, detail }, "*");
}

async function render() {
  const { owner, id } = route();
  const screen = renderReferenceScreen(owner, id);
  if (!screen) {
    document.querySelector("#app").innerHTML = `<p>Unknown reference screen: ${owner}/${id}</p>`;
    ready("failed", `${owner}/${id}`);
    return;
  }
  document.body.className = `osago-screen-embed embed-${screen.mode}`;
  document.querySelector("#app").innerHTML = screen.html;
  for (const control of document.querySelectorAll(".mobile-action,.myid-continue,.g-btn")) {
    control.setAttribute("role", "button");
    control.setAttribute("tabindex", "0");
    const activate = () => control.setAttribute("data-activated", "true");
    control.addEventListener("click", activate);
    control.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") activate();
    });
  }
  try {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((image) =>
        image.complete
          ? image.naturalWidth > 0
            ? Promise.resolve()
            : Promise.reject(new Error(`Image failed: ${image.currentSrc || image.src}`))
          : new Promise((resolve, reject) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener(
                "error",
                () => reject(new Error(`Image failed: ${image.currentSrc || image.src}`)),
                { once: true },
              );
            }),
      ),
    );
    ready();
  } catch (error) {
    ready("partial", error instanceof Error ? error.message : String(error));
  }
}

addEventListener("hashchange", render);
addEventListener("keydown", (event) => {
  if (event.key === "Escape") parent.postMessage({ type: "visual-canvas:escape" }, "*");
});
render();
