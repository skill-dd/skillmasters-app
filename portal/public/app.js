initPortal();

async function initPortal() {
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    document.querySelector("#thumbnailAppLink").href = config.thumbnailsUrl || "/kurs-thumbnails/";
    document.querySelector("#presentationAppLink").href = config.presentationsUrl || "/praesentationsfolien/";
  } catch {
    document.querySelector("#thumbnailAppLink").href = "/kurs-thumbnails/";
    document.querySelector("#presentationAppLink").href = "/praesentationsfolien/";
  }
}
