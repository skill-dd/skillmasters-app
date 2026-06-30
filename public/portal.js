initPortal();

async function initPortal() {
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    const paths = config.paths || {};
    document.querySelector("#thumbnailAppLink").href = paths.thumbnails || "/kurs-thumbnails/";
    document.querySelector("#presentationAppLink").href = paths.presentations || "/praesentationsfolien/";
  } catch {
    document.querySelector("#thumbnailAppLink").href = "/kurs-thumbnails/";
    document.querySelector("#presentationAppLink").href = "/praesentationsfolien/";
  }
}
