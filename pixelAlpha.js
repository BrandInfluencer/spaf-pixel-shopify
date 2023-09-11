const analytics = window.Shopify.analytics;
const pixel_id = "R2hiZXREek9oTmVWUzBNdzFycDg=";
analytics.subscribe("product_viewed", async (event) => {
  console.log(event);
  await spaf(pixel_id, spaf_callback_names.product_viewed, event);
});

analytics.subscribe("product_added_to_cart", async (event) => {
  console.log(event);
});

analytics.subscribe("checkout_started", async (event) => {
  await spaf(pixel_id, spaf_callback_names.start_checkout, event);
});

analytics.subscribe("checkout_completed", async (event) => {
  await spaf(pixel_id, spaf_callback_names.track_purchase, event);
});

analytics.subscribe("page_viewed", async (event) => {
  await spaf(pixel_id, spaf_callback_names.track_visit, event);
});

const api_link =
  "https://us-central1-socialpi-app.cloudfunctions.net/brand_app/api/affiliate";

const makePostHeader = (pixel_id) => {
  return {
    Accept: "*/*",
    Authorization: "Bearer " + pixel_id,
    "Content-type": "application/json",
    mode: "cors",
  };
};

async function getCommissionDetails(pixel_id, link, product = null) {
  console.log("getting commission details");
  return new Promise((resolve) => {
    const payload = { affiliate_link: link, product: product };
    fetch(`${api_link}/get_commission_details`, {
      method: "POST",
      headers: makePostHeader(pixel_id),
      body: JSON.stringify(payload),
    }).then((response) => {
      console.log("Response from API function getCommissionDetails");
      return resolve(response.json());
    });
  });
}

const productViewedMiddleware = async (pixel_id, event) => {
  const link = event.context.document.location.href;
  const spaf = checkStorageForSPaf();
  let product = {
    ...event.data.productVariant.product,
    product_link:
      event.context.document.location.origin +
      event.context.document.location.pathname,
  };

  if (link.includes("origin=SPAF")) {
    const payload = {
      affiliate_link: link,
      native_product: {
        link:
          event.context.document.location.origin +
          event.context.document.location.pathname,
        snap: { ...event },
        id: product.data.productVariant.product.id,
      },
    };
    sendVisitCallback(pixel_id, payload).then(() => {
      if (!spaf) {
        initSpaf(link).then(async () => {
          await addProductToSpaf(link, product);
        });
      }
    });
  } else if (spaf) {
    let native_product = {
      link: product.product_link,
      id: event.data.productVariant.product.id,
      snap: { ...event.data },
    };
    sendTrackProductViewCallback(pixel_id, native_product).then(
      async (response) => {
        await addProductToSpaf(spaf.origin_link, {
          ...product,
          spaf_id: response.product,
        });
      }
    );
  }
  //console.log(event);
};

async function sendTrackProductViewCallback(pixel_id, native_product) {
  console.log("sending track product view callback");
  const payload = { native_product };
  return new Promise((resolve) => {
    fetch(`${api_link}/track_product_view`, {
      method: "POST",
      headers: makePostHeader(pixel_id),
      body: JSON.stringify(payload),
    }).then((response) => {
      console.log("Response from API function sendTrackProductViewCallback");
      return resolve(response.json());
    });
  });
}

const trackVisitMiddleware = async (pixel_id, event) => {
  const link = event.context.document.location.href;
  const visitParams = link.includes("?") ? getURLParmas() : null;
  if (
    visitParams &&
    visitParams.origin === "SPAF" &&
    !link.includes("products")
  ) {
    const spaf = checkStorageForSPaf();
    await sendVisitCallback(pixel_id, { affiliate_link: link });
    if (spaf?.origin_affiliate !== getURLParmas(link).affl || !spaf)
      await initSpaf(link);
  }
};

async function sendVisitCallback(pixel_id, payload) {
  console.log("Sending visit callback");
  /*  const shopify_product = product
    ? {
        link:
          product.context.document.location.origin +
          product.context.document.location.pathname,
        snap: { ...product.data },
        id: product.data.productVariant.product.id,
      }
    : null; */
  fetch(`${api_link}/track_visit`, {
    method: "POST",
    headers: makePostHeader(pixel_id),
    body: JSON.stringify(payload),
  }).then((response) => {
    console.log("Response from API function sendVisitCallback");
    return response.json();
  });
}

async function sendPurchaseCallback(pixel_id, payload) {
  fetch(`${api_link}/calculate_commission`, {
    method: "POST",
    headers: makePostHeader(pixel_id),
    body: JSON.stringify(payload),
  }).then((response) => {
    console.log("Response from AP function sendPurchaseCallback");
    return response.json();
  });
}

const getURLParmas = (link = null) => {
  let params = {};
  const query_params = link
    ? link.split("?")[1]
    : window.location.href.split("?")[1];
  const param_key_value_list = query_params.split("&");
  param_key_value_list.map((key_value) => {
    const [key, value] = key_value.split("=");
    params[key] = value;
    return 0;
  });
  return params;
};

const saveSpafToStorage = (spaf) => {
  localStorage.setItem("spaf", JSON.stringify(spaf));
};

const checkStorageForSPaf = () => {
  const stored_spaf = localStorage.getItem("spaf");
  if (!stored_spaf) return false;
  return JSON.parse(stored_spaf);
};

async function addProductToSpaf(link, product) {
  /**
   * this function is called only if spaf already exists
   * product must have id and product_link
   */
  const old_spaf = checkStorageForSPaf();
  const commission_details = product.spaf_id
    ? {
        origin_link: old_spaf.origin_link,
        origin_affiliate: old_spaf.origin_affiliate,
        expiry: old_spaf.expiry,
        product: product.spaf_id,
      }
    : await getCommissionDetails(pixel_id, link, product);

  /**
   * commission_details contain the original affiliate link sent in payload
   * product is added to spaf only after product view callback has been
   * sent which implies that a product has already been made in sp db
   * and a sp product id associated with the store product
   */

  if (commission_details.product) {
    const spaf_product = {
      shopify_id: product.id,
      origin_link: commission_details.origin_link,
      origin_affiliate: commission_details.origin_affiliate,
      spaf_id: product.spaf_id ?? commission_details.product,
      expiry: commission_details.expiry ?? old_spaf.expiry,
      product_link: product.product_link,
      timestamp: Date.now(),
      origin_history: old_spaf.products[product.id]
        ? old_spaf.products[product.id].origin_affiliate !==
          commission_details.origin_affiliate
          ? [
              {
                origin_affiliate:
                  old_spaf.products[product.id].origin_affiliate,
                origin_link: old_spaf.products[product.id].origin_link,
                expiry: old_spaf.products[product.id].expiry,
                timestamp: old_spaf.products[product.id].timestamp,
              },
              ...old_spaf.products[product.id].origin_history,
            ]
          : [...old_spaf.products[product.id].origin_history]
        : [],
    };

    const new_spaf = { ...old_spaf, [`products.${product.id}`]: spaf_product };
    saveSpafToStorage(new_spaf);
  }
}

async function initSpaf(link) {
  console.log("Initializing spaf");
  const old_spaf = checkStorageForSPaf();
  const commission_details = await getCommissionDetails(pixel_id, link);

  //console.log(commission_details);

  const spaf = {
    origin_link: commission_details.origin_link,
    origin_affiliate: commission_details.origin_affiliate,
    origin_history: old_spaf
      ? [{ ...old_spaf }, ...old_spaf.origin_history]
      : [],
    products: old_spaf ? { ...old_spaf.products } : {},
    expiry: commission_details.expiry,
    timestamp: Date.now(),
  };
  saveSpafToStorage(spaf);
}

const spaf_callback_names = {
  track_visit: "track_visit",
  add_cart: "add_cart",
  track_purchase: "track_purchase",
  save_cookie: "save_cookie",
  start_checkout: "start_checkout",
  product_viewed: "product_viewed",
};

//spaf interface switch
async function spaf(pixel_id, callback_name, data) {
  /*   switch (callback_name) {
    case spaf_callback_names.track_visit:
      await trackVisitMiddleware(pixel_id, data);
      return 0;
    case spaf_callback_names.track_purchase:
      await trackPurchaseMiddleware(pixel_id, data);
      return 0;
    case spaf_callback_names.product_viewed:
      await productViewedMiddleware(pixel_id, data);
      return 0;
    case spaf_callback_names.start_checkout:
      await checkoutStartedMiddleware(pixel_id, data);
      return 0;
    default:
      break;
  } */
}

//#region
//Interface middleware functions

const checkoutStartedMiddleware = async (pixel_id, event) => {
  const line_items = event.data.checkout.lineItems;
  const product = line_items[0].variant.product;
  const spaf = checkStorageForSPaf();

  if (
    event.context.document.referrer.includes("products") &&
    line_items.length === 1 &&
    spaf &&
    !Object.keys(spaf.products).includes(product.id)
  ) {
    const native_product = {
      id: product.id,
      link: event.context.document.referrer.split("?")[0],
      snap: {},
    };
    sendTrackProductViewCallback(pixel_id, native_product).then(
      async (response) => {
        if (response.product)
          await addProductToSpaf(spaf.origin_link, {
            ...product,
            spaf_id: response.product,
            product_link: event.context.document.referrer.split("?")[0],
          });
      }
    );
  }
  //console.log(event);
};

//Middleware for tracking purchase
//It checks for SPAF
//segragates line items as per payload requirement and
//invokes the API function to send callback with relevant payload
const trackPurchaseMiddleware = async (pixel_id, event) => {
  const spaf = checkStorageForSPaf();
  if (spaf) {
    const spaf_products = { ...spaf.products };
    const spaf_product_ids = Object.keys(spaf_products);
    let line_items = [];
    const checkout = event.data.checkout;
    const lineItems = event.data.checkout.lineItems;

    line_items = lineItems.map((lineItem) => {
      let line_item = { snap: { ...lineItem } };
      const product = lineItem.variant.product;
      if (spaf_product_ids.includes(product.id)) {
        line_item.spaf_id = spaf_products[product.id].spaf_id;
        line_item.product_link = spaf_products[product.id].product_link;
      }
      line_item.product_id = product.id;
      line_item.sub_total = lineItem.variant.price.amount * lineItem.quantity;
      line_item.variant_id = lineItem.variant.id;
      line_item.quantity = lineItem.quantity;
      line_item.affiliate_link = spaf.origin_link;

      return line_item;
    });

    const payload = {
      affiliate_link: spaf.origin_affiliate,
      txn_token: checkout.token,
      client_id: event.clientId,
      order: {
        id: checkout.order.id.split("OrderIdentity/")[1],
        sub_total: checkout.subtotalPrice.amount,
        currency: checkout.subtotalPrice.currencyCode,
        total_items: lineItems.length,
        token: checkout.token,
        snap: { ...event },
      },
      line_items: line_items,
    };
    await sendPurchaseCallback(pixel_id, payload);
  }
  //console.log(event);
};
