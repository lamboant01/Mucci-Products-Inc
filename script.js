const shopUrl = window.MUCCI_CONFIG?.etsyUrl || "https://www.etsy.com/shop/MucciProducts?ref=dashboard-header";

document.querySelectorAll("[data-etsy-link]").forEach((link) => {
  link.setAttribute("href", shopUrl);
});

document.querySelector("#year").textContent = new Date().getFullYear();
