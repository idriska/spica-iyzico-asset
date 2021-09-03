/***********************************************************************
What can this asset do?
  -You can receive payment through the Iyzico system
HOW TO USE? 
    1- Create Iyzico account 
        * Sandbox https://sandbox-merchant.iyzipay.com/auth/register
        * Product https://www.iyzico.com/en/business/signup-business-account
    2- In merchant settings, copy the API Key and Secret Key
    3- Set IYZIPAY_API_KEY, IYZIPAY_SECRET_KEY, IYZIPAY_URI values in Environment Variables
    4- Send a POST request to the endpoint https://<PROJECT DOMAIN>.hq.spicaengine.com/api/fn-execute/iyzipay
    5- Body parameters should be like this
        {
            formType: 'popup', // If you want to use the Iyzico payment form (There are 2 types: popup, responsive)
            data: {
                locale: 'TR', // not required (default TR),
                currency: 'TRY', // not required (default TRY),
                installment: '1', // not required (default 1 There are 6 types: 1, 2, 3, 6, 9, 12)
                // If you want to use the Iyzico payment form, do not include in "paymentCard" parameter
                // paymentCard: '61307f580d902e002c3ca185', // If using a saved card, set the _id from the IYZICO-Payment Card Bucket
                paymentCard: {
                    register_card: '0', // not required
                    card_holder_name: 'Test User',
                    card_number: '4603450000000000',
                    expire_month: '12',
                    expire_year: '25',
                    cvc: '152',
                    zip_code: '07000', // not required
                },
                // buyer: '61307fb00d902e002c3ca187', // If using a saved buyer, set the _id from the IYZICO-Buyer Bucket
                buyer: {
                    id: 'BWDQ',
                    name: 'Test',
                    surname: 'User',
                    email: 'test@gmail.com',
                    identity_number: '231312123412',
                    gsm_number: '333232432',
                    ip: '192.168.1.1',
                    city: 'Antalya',
                    country: 'Turkey',
                    registration_address: 'Arapsuyu mah. Konyaaltı',
                    zipCode: '07000', // not required
                },
                // billingAddress: '612f70600d902e002c3ca0ca', // If using a saved billingAddress, set the _id from the IYZICO-Billing Address Bucket
                billingAddress: {
                    city: 'Istanbul',
                    country: 'Turkey',
                    address: 'Nidakule Göztepe, Merdivenköy Mah. Bora Sok. No:1',
                    contact_name: 'Test User',
                    zip_code: '34000', // not required
                },
                // shippingAddress is required if there is a PHYSICAL type product in the basket. Not required (for VIRTUAL type products)
                // shippingAddress: '61307f330d902e002c3ca183', // If using a saved shippingAddress, set the _id from the IYZICO-Shipping Address Bucket
                shippingAddress: {
                    contact_name: 'Test User',
                    city: 'Antalya',
                    country: 'Turkey',
                    address: 'Arapsuyu mah. Konyaaltı',
                    zip_code: '07000', // not required
                },
                // basket: '61307ef20d902e002c3ca17f', // If using a saved basket, set the _id from the IYZICO-Basket Items Address Bucket
                basket: {
                    name: 'Basket',
                    product: ['612f8cc00d902e002c3ca0e3', '612f92200d902e002c3ca0f1'], // In the array, add the _id of the product that is in the IYZICO-Product Bucket
                },
                paidPrice: 160,
            },
        };
        
NOTES * 
 - Do not change the filled environment variables
/************************************************************************/

import * as Bucket from "@spica-devkit/bucket";
const Iyzipay = require("iyzipay");

const SECRET_API_KEY = process.env.SECRET_API_KEY;
const PAY_BUCKET_ID = process.env.PAY_BUCKET_ID;
const BUYER_BUCKET_ID = process.env.BUYER_BUCKET_ID;
const PAYMENT_CARD_BUCKET_ID = process.env.PAYMENT_CARD_BUCKET_ID;
const BILLING_ADDRESS_BUCKET_ID = process.env.BILLING_ADDRESS_BUCKET_ID;
const SHIPPING_ADDRESS_BUCKET_ID = process.env.SHIPPING_ADDRESS_BUCKET_ID;
const BASKET_ITEMS_BUCKET_ID = process.env.BASKET_ITEMS_BUCKET_ID;

const IYZIPAY_API_KEY = process.env.IYZIPAY_API_KEY;
const IYZIPAY_SECRET_KEY = process.env.IYZIPAY_SECRET_KEY;
const IYZIPAY_URI = process.env.IYZIPAY_URI;

const iyzipay = new Iyzipay({
    apiKey: IYZIPAY_API_KEY,
    secretKey: IYZIPAY_SECRET_KEY,
    uri: IYZIPAY_URI
});

export async function payment(req, res) {
    const { formType = "popup", data } = req.body;
    Bucket.initialize({ apikey: SECRET_API_KEY });

    try {
        let buyerData = await getBuyerData(data.buyer);
        let cardData = await getPaymentCard(data, buyerData);
        let billingAddressData = await getBillingAddress(data.billingAddress);
        let shippingAddressData = await getShippingAddress(data.shippingAddress);
        let basketData = await getBasketData(data.basket);
        let price = await getPrice(basketData);

        let paymentData = {
            locale: data.locale || "TR",
            price: String(price),
            paid_price: String(data.paidPrice),
            currency: data.currency || "TRY",
            installment: data.installment ? String(data.installment) : "1",
            payment_card: cardData,
            buyer: buyerData,
            shipping_address: shippingAddressData,
            billing_address: billingAddressData,
            basket_items: basketData
        };

        const payData = await Bucket.data.insert(PAY_BUCKET_ID, paymentData);

        const payRequest = await getPaymentData(payData._id);

        if (payRequest.paymentCard) {
            iyzipay.payment.create(payRequest, async function(err, result) {
                if (err) {
                    return res.status(400).send({ message: err });
                } else {
                    let status = 200;
                    if (result.status == "failure") status = 400;

                    await updatePayData(
                        payData,
                        result.status,
                        result.paymentId,
                        result.errorMessage
                    );
                    return res.status(status).send({ message: result });
                }
            });
        } else {
            payRequest["callbackUrl"] = "https://www.merchant.com/callback";
            iyzipay.checkoutFormInitialize.create(payRequest, function(err, result) {
                if (err) {
                    return res.status(400).send({ message: err });
                } else {
                    res.headers.set("Content-Type", "text/html");
                    return res
                        .status(200)
                        .send(
                            `${result.checkoutFormContent}<div id="iyzipay-checkout-form" class="${formType}"></div>`
                        );
                }
            });
        }
    } catch (err) {
        console.log(err);
        return res.status(400).send({ message: err });
    }
}

async function updatePayData(payData, status, paymentId, errorMessage) {
    Bucket.initialize({ apikey: SECRET_API_KEY });

    payData.status = status;
    payData.payment_id = paymentId;
    payData.error_message = errorMessage;

    await Bucket.data
        .update(`${PAY_BUCKET_ID}`, payData._id, payData)
        .catch(err => console.log("ERROR 2", err));
}

async function getBuyerData(buyer) {
    Bucket.initialize({ apikey: SECRET_API_KEY });
    let buyerData;

    if (typeof buyer == "string") {
        buyerData = buyer;
    } else {
        const existingBuyer = await Bucket.data.getAll(BUYER_BUCKET_ID, {
            queryParams: {
                filter: {
                    email: buyer.email
                }
            }
        });

        if (existingBuyer[0] && existingBuyer[0].email == buyer.email) {
            buyerData = existingBuyer[0]._id;
        } else {
            buyerData = await Bucket.data.insert(BUYER_BUCKET_ID, buyer);
            buyerData = buyerData._id;
        }
    }

    return buyerData;
}

async function getPaymentCard(data, buyerData) {
    Bucket.initialize({ apikey: SECRET_API_KEY });
    let cardData;
    
    //createCard(data, buyerData) !TODO
    
    if (data.paymentCard) {
        if (typeof data.paymentCard == "string") {
            cardData = data.paymentCard;
        } else {
            const existingCard = await Bucket.data.getAll(PAYMENT_CARD_BUCKET_ID, {
                queryParams: {
                    filter: {
                        card_number: data.paymentCard.card_number
                    }
                }
            });

            if (existingCard[0] && existingCard[0].card_number == data.paymentCard.card_number) {
                cardData = existingCard[0]._id;
            } else {
                cardData = await Bucket.data.insert(PAYMENT_CARD_BUCKET_ID, data.paymentCard);
                cardData = cardData._id;
            }
        }
    }

    return cardData;
}

// function createCard(data, buyerData) {
//     iyzipay.card.create(
//         {
//             locale: data.locale || "TR",
//             email: buyerData.email,
//             card: {
//                 cardAlias: `${buyerData.name} ${buyerData.surname} card`,
//                 cardHolderName: data.paymentCard.card_holder_name,
//                 cardNumber: data.paymentCard.card_number,
//                 expireMonth: data.paymentCard.expire_month,
//                 expireYear: data.paymentCard.expire_year
//             }
//         },
//         function(err, result) {
//             console.log(err, result);
//             done();
//         }
//     );
// }

async function getBillingAddress(billingAddress) {
    Bucket.initialize({ apikey: SECRET_API_KEY });
    let billingAddressData;
    if (typeof billingAddress == "string") {
        billingAddressData = billingAddress;
    } else {
        billingAddressData = await Bucket.data.insert(BILLING_ADDRESS_BUCKET_ID, billingAddress);
        billingAddressData = billingAddressData._id;
    }
    return billingAddressData;
}

async function getShippingAddress(shippingAddress) {
    Bucket.initialize({ apikey: SECRET_API_KEY });
    let shippingAddressData;
    if (shippingAddress) {
        if (typeof shippingAddress == "string") {
            shippingAddressData = shippingAddress;
        } else {
            shippingAddressData = await Bucket.data.insert(
                SHIPPING_ADDRESS_BUCKET_ID,
                shippingAddress
            );
            shippingAddressData = shippingAddressData._id;
        }
    }

    return shippingAddressData;
}

async function getBasketData(basket) {
    Bucket.initialize({ apikey: SECRET_API_KEY });
    let basketData;
    if (typeof basket == "string") {
        basketData = basket;
    } else {
        basketData = await Bucket.data.insert(BASKET_ITEMS_BUCKET_ID, basket);
        basketData = basketData._id;
    }
    return basketData;
}

async function getPrice(basketData) {
    Bucket.initialize({ apikey: SECRET_API_KEY });
    let price = 0;

    const basketItems = await Bucket.data.get(`${BASKET_ITEMS_BUCKET_ID}`, basketData, {
        queryParams: {
            relation: true
        }
    });

    basketItems.product.forEach(el => {
        price += Number(el.price);
    });

    return price;
}

async function getPaymentData(payId) {
    Bucket.initialize({ apikey: SECRET_API_KEY });
    let objects = ["payment_card", "buyer", "shipping_address", "billing_address"];
    let payRequest = await Bucket.data.get(`${PAY_BUCKET_ID}`, payId, {
        queryParams: {
            relation: ["payment_card", "buyer", "shipping_address", "billing_address"]
        }
    });

    const basket = await Bucket.data.get(`${BASKET_ITEMS_BUCKET_ID}`, payRequest.basket_items, {
        queryParams: {
            relation: true
        }
    });

    delete payRequest["_id"];
    delete payRequest["basket_items"];

    if (!payRequest["payment_card"]) {
        delete payRequest["payment_card"];
        objects = removeItemFormObj(objects, "payment_card");
    }
    if (!payRequest["shipping_address"]) {
        delete payRequest["shipping_address"];
        objects = removeItemFormObj(objects, "shipping_address");
    }

    payRequest["basket_items"] = basket.product;

    for (let obj of objects) {
        delete payRequest[obj]["_id"];
        payRequest[obj] = replaceObject(payRequest[obj]);
    }

    for (let [index, obj] of payRequest["basket_items"].entries()) {
        delete obj["_id"];
        payRequest["basket_items"][index] = replaceObject(obj);
    }

    payRequest = replaceObject(payRequest);

    return payRequest;
}

// HELPER FUNCTIONS
function removeItemFormObj(objects, item) {
    const index = objects.indexOf(item);
    if (index > -1) {
        objects.splice(index, 1);
    }
    return objects;
}

function replaceObject(obj) {
    return Object.fromEntries(Object.entries(obj).map(([key, value]) => [replaceKey(key), value]));
}

function replaceKey(key) {
    key = key.split("_");
    for (const [i, v] of key.entries()) {
        if (i != 0) {
            key[i] = capitalize(v);
        }
    }
    return (key = key.join(""));
}

function capitalize(value) {
    const lower = value.toLowerCase();
    return value.charAt(0).toUpperCase() + lower.slice(1);
}
