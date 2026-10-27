(function () {
  "use strict";

  const API = window.BAZAARMAN_API_BASE_URL || "";
  let csrf = "";
  let panel = null;

  async function request(path, options = {}) {
    const headers = { Accept: "application/json" };

    if (options.body instanceof FormData) {
      // مرورگر خودش Content-Type مناسب را تنظیم می‌کند.
    } else if (options.body) {
      headers["Content-Type"] = "application/json";
    }

    if (options.method && options.method !== "GET") {
      if (!csrf) {
        const r = await fetch(API + "/api/csrf-token", {
          credentials: "include"
        });
        const d = await r.json();
        csrf = d.csrf_token || "";
      }
      headers["X-CSRF-Token"] = csrf;
    }

    const response = await fetch(API + path, {
      credentials: "include",
      ...options,
      headers: { ...headers, ...(options.headers || {}) }
    });

    const data = await response.json().catch(() => ({}));

    if (data.csrf_token) csrf = data.csrf_token;
    if (!response.ok) {
      throw new Error(data.error || data.message || "درخواست ناموفق بود.");
    }
    return data;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;",
      '"': "&quot;", "'": "&#39;"
    })[ch]);
  }

  function imageURL(value) {
    if (!value) return "";
    try {
      return new URL(value, API || location.origin).href;
    } catch (_) {
      return "";
    }
  }

  function init(seller, container) {
    if (!seller || seller.status !== "active" || !container) return;

    if (container.querySelector("#bsmProductPanel")) {
      panel = container.querySelector("#bsmProductPanel");
      loadProducts();
      return;
    }

    panel = document.createElement("section");
    panel.id = "bsmProductPanel";
    panel.style.cssText =
      "margin:16px 0;padding:14px;border:1px solid #ddd;border-radius:12px;text-align:right";

    panel.innerHTML = `
      <h3>مدیریت محصولات فروشگاه</h3>
      <form id="bsmProductForm">
        <label>نام محصول
          <input name="name" required maxlength="200"
            style="display:block;width:100%;margin:6px 0 12px;padding:10px;box-sizing:border-box">
        </label>
        <label>توضیحات
          <textarea name="description" maxlength="5000" rows="3"
            style="display:block;width:100%;margin:6px 0 12px;padding:10px;box-sizing:border-box"></textarea>
        </label>
        <label>قیمت به تومان
          <input name="price" type="number" min="0" step="1" required
            style="display:block;width:100%;margin:6px 0 12px;padding:10px;box-sizing:border-box">
        </label>
        <label>موجودی
          <input name="stock" type="number" min="0" step="1" required
            style="display:block;width:100%;margin:6px 0 12px;padding:10px;box-sizing:border-box">
        </label>
        <label>عکس محصول (اختیاری، حداکثر ۵ مگابایت)
          <input name="image" type="file" accept="image/jpeg,image/png,image/webp"
            style="display:block;width:100%;margin:6px 0 12px">
        </label>
        <button type="submit">ثبت محصول</button>
        <p id="bsmProductMessage" role="status"></p>
      </form>
      <hr>
      <h4>محصولات ثبت‌شده</h4>
      <div id="bsmProductList">در حال دریافت محصولات...</div>
    `;

    const logout = container.querySelector("#bsmLogout");
    if (logout) container.insertBefore(panel, logout);
    else container.appendChild(panel);

    panel.querySelector("#bsmProductForm").addEventListener("submit", saveProduct);
    panel.querySelector("#bsmProductList").addEventListener("click", productAction);
    loadProducts();
  }

  async function loadProducts() {
    if (!panel || !panel.isConnected) return;

    const list = panel.querySelector("#bsmProductList");
    try {
      const data = await request("/api/seller/products");
      const products = data.products || [];

      if (!products.length) {
        list.textContent = "هنوز محصولی ثبت نکرده‌اید.";
        return;
      }

      list.innerHTML = products.map(p => {
        const img = p.image_url
          ? `<img src="${escapeHTML(imageURL(p.image_url))}" alt=""
               style="max-width:90px;max-height:90px;object-fit:contain">`
          : "";
        return `
          <article style="border:1px solid #ddd;border-radius:8px;padding:10px;margin:10px 0">
            ${img}
            <strong>${escapeHTML(p.name)}</strong>
            <p>${escapeHTML(p.description || "")}</p>
            <p>قیمت: ${escapeHTML(p.price)} تومان</p>
            <p>موجودی: ${escapeHTML(p.stock)}</p>
            <p>وضعیت: ${Number(p.is_active) === 1 ? "فعال" : "در انتظار فعال‌سازی"}</p>
            <button type="button" data-action="edit" data-id="${Number(p.id)}">ویرایش</button>
            <button type="button" data-action="delete" data-id="${Number(p.id)}">حذف</button>
          </article>`;
      }).join("");
    } catch (error) {
      list.textContent = "دریافت محصولات ناموفق بود: " + error.message;
    }
  }

  async function saveProduct(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = panel.querySelector("#bsmProductMessage");
    const submit = form.querySelector('button[type="submit"]');
    const fd = new FormData(form);
    const image = fd.get("image");

    submit.disabled = true;
    message.textContent = "در حال ثبت محصول...";

    try {
      const data = await request("/api/seller/products", {
        method: "POST",
        body: JSON.stringify({
          name: String(fd.get("name") || "").trim(),
          description: String(fd.get("description") || "").trim(),
          price: Number(fd.get("price")),
          stock: Number(fd.get("stock"))
        })
      });

      const id = data.product && data.product.id;
      if (image instanceof File && image.size > 0) {
        if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
          throw new Error("محصول ثبت شد، اما شناسه معتبر دریافت نشد؛ تصویر بارگذاری نشد.");
        }
        const upload = new FormData();
        upload.append("image", image);
        await request("/api/seller/products/" + id + "/image", {
          method: "POST",
          body: upload
        });
      }

      form.reset();
      message.textContent = "محصول ثبت شد. نمایش عمومی آن به فعال‌سازی نیاز دارد.";
      await loadProducts();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  }

  async function productAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const id = button.dataset.id;
    const action = button.dataset.action;

    try {
      if (action === "delete") {
        if (!confirm("این محصول حذف شود؟")) return;
        await request("/api/seller/products/" + id, { method: "DELETE" });
      } else if (action === "edit") {
        const article = button.closest("article");
        const oldName = article.querySelector("strong").textContent;
        const oldDescription = article.querySelector("p").textContent;
        const oldPrice = article.querySelectorAll("p")[1].textContent.replace(/[^\d]/g, "");
        const oldStock = article.querySelectorAll("p")[2].textContent.replace(/[^\d]/g, "");

        const name = prompt("نام محصول:", oldName);
        if (name === null) return;
        const description = prompt("توضیحات:", oldDescription);
        if (description === null) return;
        const price = prompt("قیمت به تومان:", oldPrice);
        if (price === null) return;
        const stock = prompt("موجودی:", oldStock);
        if (stock === null) return;

        await request("/api/seller/products/" + id, {
          method: "PATCH",
          body: JSON.stringify({
            name: name.trim(),
            description,
            price: Number(price),
            stock: Number(stock)
          })
        });
      }
      await loadProducts();
    } catch (error) {
      alert(error.message);
    }
  }

  window.BAZARMAN_INIT_SELLER_PRODUCTS = init;
})();
