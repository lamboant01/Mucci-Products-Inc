const shopUrl = "https://www.etsy.com/";

document.querySelectorAll("[data-etsy-link]").forEach((link) => {
  link.setAttribute("href", shopUrl);
});

document.querySelector("#year").textContent = new Date().getFullYear();
