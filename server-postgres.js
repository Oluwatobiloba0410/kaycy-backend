const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());

/* =====================================================
CLOUDINARY CONFIGURATION
===================================================== */

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

/* =====================================================
MULTER IMAGE UPLOAD CONFIGURATION
===================================================== */

const upload = multer({

    storage: multer.memoryStorage(),

    limits: {
        fileSize: 5 * 1024 * 1024
    },

    fileFilter: (req, file, cb) => {

        if (!file.mimetype.startsWith("image/")) {

            return cb(
                new Error("Only image files are allowed.")
            );

        }

        cb(null, true);

    }

});

/* =====================================================
OPTION VALIDATION
===================================================== */

function cleanProductOptions(options) {

    if (options === undefined || options === null) {
        return [];
    }

    if (!Array.isArray(options)) {
        throw new Error(
            "Product options must be an array."
        );
    }

    const cleanedOptions = [];

    for (const option of options) {

        if (!option || typeof option !== "object") {
            throw new Error(
                "Invalid product option."
            );
        }

        const optionName =
            String(option.name || "").trim();

        if (!optionName) {
            throw new Error(
                "Every product option must have a name."
            );
        }

        if (!Array.isArray(option.values)) {
            throw new Error(
                `Option "${optionName}" must contain values.`
            );
        }

        if (option.values.length === 0) {
            throw new Error(
                `Option "${optionName}" must contain at least one value.`
            );
        }

        const cleanedValues = [];

        for (const value of option.values) {

            if (!value || typeof value !== "object") {
                throw new Error(
                    `Invalid value in "${optionName}".`
                );
            }

            const valueName =
                String(value.name || "").trim();

            if (!valueName) {
                throw new Error(
                    `Every value in "${optionName}" must have a name.`
                );
            }

            let valuePrice = null;

            if (
                value.price !== undefined &&
                value.price !== null &&
                value.price !== ""
            ) {

                valuePrice = Number(value.price);

                if (
                    !Number.isFinite(valuePrice) ||
                    valuePrice < 0
                ) {

                    throw new Error(
                        `Invalid price for "${valueName}" in "${optionName}".`
                    );

                }

                valuePrice =
                    Math.round(valuePrice);

            }

            const valueImage =
                String(value.image || "").trim();

            /*
             * Optional stock attached to an option value.
             *
             * This allows things like:
             *
             * Black = 5
             * Blue = 2
             *
             * The more advanced variant-stock system is
             * handled separately below.
             */

            let valueStock = null;

            if (
                value.stock !== undefined &&
                value.stock !== null &&
                value.stock !== ""
            ) {

                valueStock =
                    Number(value.stock);

                if (
                    !Number.isInteger(valueStock) ||
                    valueStock < 0
                ) {

                    throw new Error(
                        `Invalid stock for "${valueName}" in "${optionName}".`
                    );

                }

            }

            cleanedValues.push({

                name:
                    valueName,

                price:
                    valuePrice,

                image:
                    valueImage,

                stock:
                    valueStock

            });

        }

        cleanedOptions.push({

            name:
                optionName,

            values:
                cleanedValues

        });

    }

    return cleanedOptions;
}

/* =====================================================
VARIANT STOCK VALIDATION
===================================================== */

function cleanVariantStock(variantStock) {

    if (
        variantStock === undefined ||
        variantStock === null ||
        variantStock === ""
    ) {

        return {};

    }

    if (
        typeof variantStock !== "object" ||
        Array.isArray(variantStock)
    ) {

        throw new Error(
            "Variant stock must be an object."
        );

    }

    const cleaned = {};

    for (
        const [key, value]
        of Object.entries(variantStock)
    ) {

        const cleanKey =
            String(key).trim();

        if (!cleanKey) {
            continue;
        }

        const stock =
            Number(value);

        if (
            !Number.isInteger(stock) ||
            stock < 0
        ) {

            throw new Error(
                `Invalid stock for variant "${cleanKey}".`
            );

        }

        cleaned[cleanKey] = stock;

    }

    return cleaned;
}

/* =====================================================
GENERAL STOCK VALIDATION
===================================================== */

function cleanStock(stock) {

    if (
        stock === undefined ||
        stock === null ||
        stock === ""
    ) {

        return 0;

    }

    const cleanStockValue =
        Number(stock);

    if (
        !Number.isInteger(cleanStockValue) ||
        cleanStockValue < 0
    ) {

        throw new Error(
            "Stock must be a whole number greater than or equal to 0."
        );

    }

    return cleanStockValue;
}

/* =====================================================
VARIANT KEY CREATION
===================================================== */

function createVariantKey(selectedOptions) {

    if (
        !Array.isArray(selectedOptions) ||
        selectedOptions.length === 0
    ) {

        return "";

    }

    return selectedOptions
        .map(selection => {

            return (
                String(selection.name).trim() +
                ":" +
                String(selection.value).trim()
            );

        })
        .join("|");
}

/* =====================================================
DATABASE INITIALIZATION
===================================================== */

async function initDatabase() {

    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'customer',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            price INTEGER NOT NULL,
            category TEXT NOT NULL,
            emoji TEXT,
            description TEXT,
            image TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    /* =================================================
       PRODUCT OPTIONS
    ================================================= */

    await pool.query(`
        ALTER TABLE products
        ADD COLUMN IF NOT EXISTS options JSONB
        DEFAULT '[]'::jsonb
    `);

    await pool.query(`
        UPDATE products
        SET options = '[]'::jsonb
        WHERE options IS NULL
    `);

    /* =================================================
       PRODUCT STOCK
    ================================================= */

    await pool.query(`
        ALTER TABLE products
        ADD COLUMN IF NOT EXISTS stock INTEGER
        DEFAULT 0
    `);

    await pool.query(`
        UPDATE products
        SET stock = 0
        WHERE stock IS NULL
    `);

    /* =================================================
       VARIANT STOCK

       Example:

       {
         "Color:Black": 5,
         "Color:Blue": 2
       }

       Later, for multiple options:

       {
         "Color:Black|Size:M": 4,
         "Color:Black|Size:L": 2,
         "Color:Blue|Size:M": 7
       }
    ================================================= */

    await pool.query(`
        ALTER TABLE products
        ADD COLUMN IF NOT EXISTS variant_stock JSONB
        DEFAULT '{}'::jsonb
    `);

    await pool.query(`
        UPDATE products
        SET variant_stock = '{}'::jsonb
        WHERE variant_stock IS NULL
    `);

    /* =================================================
       ORDERS
    ================================================= */

    await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            order_number TEXT UNIQUE NOT NULL,
            user_id INTEGER,
            customer_name TEXT NOT NULL,
            customer_email TEXT,
            customer_phone TEXT,
            delivery_address TEXT,
            city TEXT,
            total INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'Order Received',
            payment_method TEXT,
            payment_status TEXT NOT NULL DEFAULT 'Payment Pending',
            payment_reference TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    /* =================================================
       ORDER ITEMS
    ================================================= */

    await pool.query(`
        CREATE TABLE IF NOT EXISTS order_items (
            id SERIAL PRIMARY KEY,
            order_id INTEGER NOT NULL,
            product_id INTEGER,
            product_name TEXT NOT NULL,
            price INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            FOREIGN KEY(order_id) REFERENCES orders(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        )
    `);

    /* =================================================
       EXISTING ORDER COLUMNS
    ================================================= */

    await pool.query(`
        ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS delivery_address TEXT
    `);

    await pool.query(`
        ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS city TEXT
    `);

    await pool.query(`
        ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS payment_status TEXT
        NOT NULL DEFAULT 'Payment Pending'
    `);

    await pool.query(`
        ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS payment_reference TEXT
    `);

    /* =================================================
       NEW ORDER ITEM VARIANT COLUMNS
    ================================================= */

    await pool.query(`
        ALTER TABLE order_items
        ADD COLUMN IF NOT EXISTS selected_options JSONB
        DEFAULT '[]'::jsonb
    `);

    await pool.query(`
        ALTER TABLE order_items
        ADD COLUMN IF NOT EXISTS variant_key TEXT
    `);

    await pool.query(`
        ALTER TABLE order_items
        ADD COLUMN IF NOT EXISTS product_image TEXT
    `);

    await pool.query(`
        UPDATE order_items
        SET selected_options = '[]'::jsonb
        WHERE selected_options IS NULL
    `);

    console.log(
        "PostgreSQL database initialized."
    );

}

/* =====================================================
HOME / TEST ROUTE
===================================================== */

app.get("/", (req, res) => {

    res.send(
        "Kaycy Mart backend and database are working! 🛒🔥"
    );

});

/* =====================================================
START SERVER
===================================================== */

initDatabase()
    .then(() => {

        app.listen(
            PORT,
            () => {

                console.log(
                    `Kaycy Mart server is running on port ${PORT}`
                );

            }
        );

    })
    .catch(error => {

        console.error(
            "Database initialization failed:",
            error
        );

        process.exit(1);

    });

/* =====================================================
ADMIN CHECK MIDDLEWARE
===================================================== */

async function requireAdmin(req, res, next) {

    const adminId =
        req.headers["x-admin-user-id"];

    if (!adminId) {

        return res.status(401).json({
            message:
                "Admin login is required."
        });

    }

    try {

        const result =
            await pool.query(`
                SELECT
                    id,
                    name,
                    email,
                    role
                FROM users
                WHERE id = $1
            `, [
                adminId
            ]);

        const admin =
            result.rows[0];

        if (!admin) {

            return res.status(401).json({
                message:
                    "Admin account could not be verified."
            });

        }

        if (admin.role !== "admin") {

            return res.status(403).json({
                message:
                    "Access denied. Admin permission required."
            });

        }

        req.admin = admin;

        next();

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message:
                "Could not verify admin account."
        });

    }

}

/* =====================================================
ADMIN — UPLOAD PRODUCT IMAGE
===================================================== */

app.post(
    "/api/admin/upload-image",
    requireAdmin,
    upload.single("image"),
    async (req, res) => {

        if (!req.file) {

            return res.status(400).json({
                message:
                    "Please select an image."
            });

        }

        try {

            const result =
                await new Promise((resolve, reject) => {

                    const stream =
                        cloudinary.uploader.upload_stream(
                            {
                                folder:
                                    "kaycy-mart/products",

                                resource_type:
                                    "image"
                            },

                            (error, result) => {

                                if (error) {
                                    reject(error);
                                } else {
                                    resolve(result);
                                }

                            }
                        );

                    stream.end(
                        req.file.buffer
                    );

                });

            res.json({

                message:
                    "Image uploaded successfully!",

                imageUrl:
                    result.secure_url

            });

        } catch (error) {

            console.error(
                "Cloudinary upload error:",
                error
            );

            res.status(500).json({
                message:
                    "Could not upload product image."
            });

        }

    }
);

/* =====================================================
GET ALL PRODUCTS
===================================================== */

app.get("/api/products", async (req, res) => {

    try {

        const result =
            await pool.query(`
                SELECT
                    id,
                    name,
                    price,
                    category,
                    emoji,
                    description,
                    image,
                    COALESCE(options, '[]'::jsonb) AS options,
                    COALESCE(stock, 0) AS stock,
                    COALESCE(
                        variant_stock,
                        '{}'::jsonb
                    ) AS variant_stock
                FROM products
                ORDER BY id ASC
            `);

        res.json(
            result.rows
        );

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message:
                "Could not load products."
        });

    }

});

/* =====================================================
REGISTER
===================================================== */

app.post("/api/register", async (req, res) => {

    const {
        name,
        email,
        phone,
        password
    } = req.body;

    if (!name || !email || !password) {

        return res.status(400).json({
            message:
                "Please fill in all required fields."
        });

    }

    try {

        const hashedPassword =
            await bcrypt.hash(
                password,
                10
            );

        const result =
            await pool.query(`
                INSERT INTO users
                (name, email, phone, password)
                VALUES ($1, $2, $3, $4)
                RETURNING id
            `, [

                name.trim(),
                email.trim(),
                phone
                    ? phone.trim()
                    : null,
                hashedPassword

            ]);

        res.status(201).json({

            message:
                "Account created successfully!",

            userId:
                result.rows[0].id

        });

    } catch (error) {

        if (error.code === "23505") {

            return res.status(409).json({
                message:
                    "That email is already registered."
            });

        }

        console.error(error);

        res.status(500).json({
            message:
                "Something went wrong."
        });

    }

});

/* =====================================================
LOGIN
===================================================== */

app.post("/api/login", async (req, res) => {

    const {
        email,
        password
    } = req.body;

    if (!email || !password) {

        return res.status(400).json({
            message:
                "Please enter your email and password."
        });

    }

    try {

        const result =
            await pool.query(`
                SELECT
                    id,
                    name,
                    email,
                    phone,
                    password,
                    role
                FROM users
                WHERE LOWER(email) = LOWER($1)
            `, [
                email.trim()
            ]);

        const user =
            result.rows[0];

        if (!user) {

            return res.status(401).json({
                message:
                    "Invalid email or password."
            });

        }

        const passwordMatches =
            await bcrypt.compare(
                password,
                user.password
            );

        if (!passwordMatches) {

            return res.status(401).json({
                message:
                    "Invalid email or password."
            });

        }

        res.json({

            message:
                "Login successful!",

            user: {

                id:
                    user.id,

                name:
                    user.name,

                email:
                    user.email,

                phone:
                    user.phone || "",

                role:
                    user.role || "customer"

            }

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message:
                "Something went wrong."
        });

    }

});

/* =====================================================
FORGOT PASSWORD — CHECK ACCOUNT
===================================================== */

app.post(
    "/api/forgot-password",
    async (req, res) => {

        const {
            email
        } = req.body;

        if (!email) {

            return res.status(400).json({
                message:
                    "Email address is required."
            });

        }

        try {

            const result =
                await pool.query(`
                    SELECT
                        id,
                        email
                    FROM users
                    WHERE LOWER(email) = LOWER($1)
                `, [
                    email.trim()
                ]);

            const user =
                result.rows[0];

            if (!user) {

                return res.status(404).json({
                    message:
                        "No account found with that email."
                });

            }

            res.json({
                message:
                    "Account found."
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                message:
                    "Could not check account."
            });

        }

    }
);

/* =====================================================
RESET PASSWORD
===================================================== */

app.post(
    "/api/reset-password",
    async (req, res) => {

        const {
            email,
            newPassword
        } = req.body;

        if (!email || !newPassword) {

            return res.status(400).json({
                message:
                    "Email and new password are required."
            });

        }

        if (newPassword.length < 6) {

            return res.status(400).json({
                message:
                    "Password must be at least 6 characters."
            });

        }

        try {

            const result =
                await pool.query(`
                    SELECT
                        id
                    FROM users
                    WHERE LOWER(email) = LOWER($1)
                `, [
                    email.trim()
                ]);

            const user =
                result.rows[0];

            if (!user) {

                return res.status(404).json({
                    message:
                        "No account found with that email."
                });

            }

            const hashedPassword =
                await bcrypt.hash(
                    newPassword,
                    10
                );

            await pool.query(`
                UPDATE users
                SET password = $1
                WHERE id = $2
            `, [

                hashedPassword,
                user.id

            ]);

            res.json({
                message:
                    "Password reset successfully."
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                message:
                    "Could not reset password."
            });

        }

    }
);

/* =====================================================
CREATE ORDER
===================================================== */

app.post(
    "/api/orders",
    async (req, res) => {

        const {
            userId,
            customerName,
            customerEmail,
            customerPhone,
            deliveryAddress,
            city,
            items,
            paymentMethod
        } = req.body;

        if (
            !userId ||
            !customerName ||
            !items ||
            !Array.isArray(items) ||
            items.length === 0
        ) {

            return res.status(400).json({
                message:
                    "User, customer information and order items are required."
            });

        }

        if (!deliveryAddress || !city) {

            return res.status(400).json({
                message:
                    "Delivery address and city are required."
            });

        }

        const client =
            await pool.connect();

        try {

            /* ================= USER CHECK ================= */

            const userResult =
                await client.query(`
                    SELECT id
                    FROM users
                    WHERE id = $1
                `, [
                    userId
                ]);

            if (
                userResult.rows.length === 0
            ) {

                return res.status(401).json({
                    message:
                        "User account could not be verified."
                });

            }


            await client.query(
                "BEGIN"
            );


            let total = 0;

            const orderItems = [];


            /* =================================================
               VALIDATE ORDER ITEMS
            ================================================= */

            for (const item of items) {

                if (
                    !item.productId ||
                    !item.quantity ||
                    Number(item.quantity) < 1
                ) {

                    throw new Error(
                        "Invalid order item."
                    );

                }


                const quantity =
                    Number(item.quantity);


                /* =================================================
                   LOCK PRODUCT ROW

                   FOR UPDATE prevents two simultaneous orders
                   from purchasing the same remaining stock.
                ================================================= */

                const productResult =
                    await client.query(`
                        SELECT
                            id,
                            name,
                            price,
                            image,
                            options,
                            stock,
                            variant_stock
                        FROM products
                        WHERE id = $1
                        FOR UPDATE
                    `, [
                        item.productId
                    ]);


                const product =
                    productResult.rows[0];


                if (!product) {

                    throw new Error(
                        "Product not found."
                    );

                }


                const productOptions =
                    Array.isArray(
                        product.options
                    )
                    ? product.options
                    : [];


                const selectedOptions =
                    Array.isArray(
                        item.selectedOptions
                    )
                    ? item.selectedOptions
                    : [];


                const cleanedSelections = [];


                /* =================================================
                   SIMPLE PRODUCT
                ================================================= */

                if (
                    productOptions.length === 0
                ) {

                    if (
                        selectedOptions.length > 0
                    ) {

                        throw new Error(
                            `Product "${product.name}" does not have selectable options.`
                        );

                    }

                }


                /* =================================================
                   VALIDATE SELECTED OPTIONS
                ================================================= */

                for (
                    const selection
                    of selectedOptions
                ) {

                    if (
                        !selection ||
                        !selection.name ||
                        !selection.value
                    ) {

                        throw new Error(
                            "Invalid product option selection."
                        );

                    }


                    const optionName =
                        String(
                            selection.name
                        ).trim();


                    const valueName =
                        String(
                            selection.value
                        ).trim();


                    const productOption =
                        productOptions.find(
                            option =>
                                String(
                                    option.name
                                )
                                .trim()
                                .toLowerCase()
                                ===
                                optionName
                                    .toLowerCase()
                        );


                    if (!productOption) {

                        throw new Error(
                            `Invalid option "${optionName}" for ${product.name}.`
                        );

                    }


                    const optionValue =
                        Array.isArray(
                            productOption.values
                        )
                        ? productOption.values.find(
                            value =>
                                String(
                                    value.name
                                )
                                .trim()
                                .toLowerCase()
                                ===
                                valueName
                                    .toLowerCase()
                        )
                        : null;


                    if (!optionValue) {

                        throw new Error(
                            `Invalid value "${valueName}" for ${optionName}.`
                        );

                    }


                    cleanedSelections.push({

                        name:
                            productOption.name,

                        value:
                            optionValue.name

                    });

                }


                /* =================================================
                   REQUIRE ALL PRODUCT OPTIONS
                ================================================= */

                if (
                    productOptions.length > 0
                ) {

                    for (
                        const productOption
                        of productOptions
                    ) {

                        const selected =
                            cleanedSelections.find(
                                selection =>
                                    selection.name
                                        .trim()
                                        .toLowerCase()
                                    ===
                                    String(
                                        productOption.name
                                    )
                                        .trim()
                                        .toLowerCase()
                            );


                        if (!selected) {

                            throw new Error(
                                `Please select ${productOption.name} for ${product.name}.`
                            );

                        }

                    }

                }


                /* =================================================
                   VARIANT KEY
                ================================================= */

                let variantKey =
                    String(
                        item.variantKey || ""
                    ).trim();


                if (
                    !variantKey &&
                    cleanedSelections.length > 0
                ) {

                    variantKey =
                        createVariantKey(
                            cleanedSelections
                        );

                }


                /* =================================================
                   DETERMINE AVAILABLE STOCK
                ================================================= */

                const variantStock =
                    product.variant_stock &&
                    typeof product.variant_stock === "object" &&
                    !Array.isArray(
                        product.variant_stock
                    )
                    ? product.variant_stock
                    : {};


                let availableStock =
                    Number(product.stock) || 0;


                let stockType =
                    "product";


                /*
                 * If this exact variant exists in
                 * variant_stock, use that quantity.
                 */

                if (
                    variantKey &&
                    Object.prototype.hasOwnProperty.call(
                        variantStock,
                        variantKey
                    )
                ) {

                    availableStock =
                        Number(
                            variantStock[variantKey]
                        ) || 0;

                    stockType =
                        "variant";

                }


                /* =================================================
                   STOCK CHECK
                ================================================= */

                if (
                    availableStock < quantity
                ) {

                    if (
                        availableStock === 0
                    ) {

                        throw new Error(
                            `${product.name} is out of stock.`
                        );

                    }


                    throw new Error(
                        `Only ${availableStock} left in stock for ${product.name}.`
                    );

                }


                /* =================================================
                   CALCULATE REAL VARIANT PRICE
                ================================================= */

                let finalPrice =
                    Number(product.price);


                let finalImage =
                    product.image || "";


                for (
                    const selection
                    of cleanedSelections
                ) {

                    const productOption =
                        productOptions.find(
                            option =>
                                String(
                                    option.name
                                )
                                .trim()
                                .toLowerCase()
                                ===
                                selection.name
                                    .trim()
                                    .toLowerCase()
                        );


                    if (!productOption) {
                        continue;
                    }


                    const optionValue =
                        productOption.values.find(
                            value =>
                                String(
                                    value.name
                                )
                                .trim()
                                .toLowerCase()
                                ===
                                selection.value
                                    .trim()
                                    .toLowerCase()
                        );


                    if (!optionValue) {
                        continue;
                    }


                    /* ================= VARIANT PRICE ================= */

                    if (
                        optionValue.price !== null &&
                        optionValue.price !== undefined &&
                        optionValue.price !== ""
                    ) {

                        const optionPrice =
                            Number(
                                optionValue.price
                            );


                        if (
                            Number.isFinite(
                                optionPrice
                            ) &&
                            optionPrice >= 0
                        ) {

                            finalPrice =
                                Math.round(
                                    optionPrice
                                );

                        }

                    }


                    /* ================= VARIANT IMAGE ================= */

                    if (
                        optionValue.image
                    ) {

                        finalImage =
                            String(
                                optionValue.image
                            ).trim();

                    }

                }


                /* ================= TOTAL ================= */

                total +=
                    finalPrice *
                    quantity;


                /* =================================================
                   REDUCE STOCK IMMEDIATELY

                   This happens inside the same transaction as
                   order creation.
                ================================================= */

                if (
                    stockType === "variant"
                ) {

                    const newVariantStock =
                        availableStock -
                        quantity;


                    await client.query(`
                        UPDATE products
                        SET variant_stock =
                            jsonb_set(
                                COALESCE(
                                    variant_stock,
                                    '{}'::jsonb
                                ),
                                ARRAY[$1],
                                to_jsonb($2::integer),
                                true
                            )
                        WHERE id = $3
                    `, [

                        variantKey,

                        newVariantStock,

                        product.id

                    ]);

                }
                else {

                    const newStock =
                        availableStock -
                        quantity;


                    await client.query(`
                        UPDATE products
                        SET stock = $1
                        WHERE id = $2
                    `, [

                        newStock,

                        product.id

                    ]);

                }


                /* ================= STORE ORDER ITEM ================= */

                orderItems.push({

                    productId:
                        product.id,

                    productName:
                        product.name,

                    price:
                        finalPrice,

                    quantity:
                        quantity,

                    selectedOptions:
                        cleanedSelections,

                    variantKey:
                        variantKey,

                    productImage:
                        finalImage

                });

            }


            /* =================================================
               CREATE ORDER NUMBER
            ================================================= */

            const orderNumber =
                "KM" +
                Date.now()
                    .toString()
                    .slice(-8);


            /* =================================================
               INSERT ORDER
            ================================================= */

            const orderResult =
                await client.query(`
                    INSERT INTO orders (
                        order_number,
                        user_id,
                        customer_name,
                        customer_email,
                        customer_phone,
                        delivery_address,
                        city,
                        total,
                        status,
                        payment_method,
                        payment_status
                    )
                    VALUES (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        $7,
                        $8,
                        $9,
                        $10,
                        $11
                    )
                    RETURNING id
                `, [

                    orderNumber,

                    userId,

                    customerName,

                    customerEmail || null,

                    customerPhone || null,

                    deliveryAddress,

                    city,

                    total,

                    "Order Received",

                    paymentMethod ||
                        "Bank Transfer",

                    "Payment Pending"

                ]);


            const orderId =
                orderResult.rows[0].id;


            /* =================================================
               INSERT ORDER ITEMS
            ================================================= */

            for (
                const item
                of orderItems
            ) {

                await client.query(`
                    INSERT INTO order_items (
                        order_id,
                        product_id,
                        product_name,
                        price,
                        quantity,
                        selected_options,
                        variant_key,
                        product_image
                    )
                    VALUES (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6::jsonb,
                        $7,
                        $8
                    )
                `, [

                    orderId,

                    item.productId,

                    item.productName,

                    item.price,

                    item.quantity,

                    JSON.stringify(
                        item.selectedOptions
                    ),

                    item.variantKey ||
                        null,

                    item.productImage ||
                        null

                ]);

            }


            await client.query(
                "COMMIT"
            );


            res.status(201).json({

                message:
                    "Order created successfully!",

                orderId:
                    orderId,

                orderNumber:
                    orderNumber,

                total:
                    total,

                status:
                    "Order Received",

                paymentStatus:
                    "Payment Pending"

            });

        } catch (error) {

            try {

                await client.query(
                    "ROLLBACK"
                );

            } catch (rollbackError) {

                console.error(
                    "Rollback failed:",
                    rollbackError
                );

            }

            console.error(
                "Create order error:",
                error
            );


            /*
             * Stock errors are returned as a normal
             * customer-facing 400 response.
             */

            const stockOrOrderErrorMessages = [

                "Invalid order item.",

                "Product not found.",

                "Invalid product option selection.",

                "does not have selectable options.",

                "Invalid option",

                "Invalid value",

                "Please select",

                "out of stock.",

                "left in stock for"

            ];


            const isExpectedError =
                stockOrOrderErrorMessages.some(
                    message =>
                        error.message
                            .includes(message)
                );


            if (isExpectedError) {

                return res.status(400).json({

                    message:
                        error.message

                });

            }


            res.status(500).json({
                message:
                    "Could not create order."
            });

        } finally {

            client.release();

        }

    }
);

/* =====================================================
GET USER'S ORDERS
===================================================== */

app.get(
    "/api/orders",
    async (req, res) => {

        const {
            userId
        } = req.query;

        if (!userId) {

            return res.status(400).json({
                message:
                    "User ID is required."
            });

        }

        try {

            const ordersResult =
                await pool.query(`
                    SELECT
                        id,
                        order_number,
                        user_id,
                        customer_name,
                        customer_email,
                        customer_phone,
                        delivery_address,
                        city,
                        total,
                        status,
                        payment_method,
                        payment_status,
                        payment_reference,
                        created_at
                    FROM orders
                    WHERE user_id = $1
                    ORDER BY id DESC
                `, [
                    userId
                ]);

            const orders =
                ordersResult.rows;

            const ordersWithItems = [];

            for (const order of orders) {

                const itemsResult =
                    await pool.query(`
                        SELECT
                            id,
                            product_id,
                            product_name,
                            price,
                            quantity,
                            selected_options,
                            variant_key,
                            product_image
                        FROM order_items
                        WHERE order_id = $1
                    `, [
                        order.id
                    ]);

                ordersWithItems.push({

                    ...order,

                    items:
                        itemsResult.rows

                });

            }

            res.json(
                ordersWithItems
            );

        } catch (error) {

            console.error(error);

            res.status(500).json({
                message:
                    "Could not load orders."
            });

        }

    }
);

/* =====================================================
GET SINGLE USER ORDER
===================================================== */

app.get(
    "/api/orders/:id",
    async (req, res) => {

        const {
            userId
        } = req.query;

        if (!userId) {

            return res.status(400).json({
                message:
                    "User ID is required."
            });

        }

        try {

            const orderResult =
                await pool.query(`
                    SELECT
                        id,
                        order_number,
                        user_id,
                        customer_name,
                        customer_email,
                        customer_phone,
                        delivery_address,
                        city,
                        total,
                        status,
                        payment_method,
                        payment_status,
                        payment_reference,
                        created_at
                    FROM orders
                    WHERE id = $1
                    AND user_id = $2
                `, [

                    req.params.id,
                    userId

                ]);

            const order =
                orderResult.rows[0];

            if (!order) {

                return res.status(404).json({
                    message:
                        "Order not found."
                });

            }

            const itemsResult =
                await pool.query(`
                    SELECT
                        id,
                        product_id,
                        product_name,
                        price,
                        quantity,
                        selected_options,
                        variant_key,
                        product_image
                    FROM order_items
                    WHERE order_id = $1
                `, [
                    req.params.id
                ]);

            res.json({

                order:
                    order,

                items:
                    itemsResult.rows

            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                message:
                    "Could not load order."
            });

        }

    }
);

/* =====================================================
CUSTOMER — SUBMIT PAYMENT REFERENCE
===================================================== */

app.post(
    "/api/orders/:id/payment",
    async (req, res) => {

        const {
            userId,
            paymentReference
        } = req.body;

        if (!userId) {

            return res.status(400).json({
                message:
                    "User ID is required."
            });

        }

        if (
            !paymentReference ||
            !String(paymentReference).trim()
        ) {

            return res.status(400).json({
                message:
                    "Payment reference is required."
            });

        }

        try {

            const orderResult =
                await pool.query(`
                    SELECT
                        id,
                        user_id,
                        payment_status
                    FROM orders
                    WHERE id = $1
                    AND user_id = $2
                `, [

                    req.params.id,
                    userId

                ]);

            const order =
                orderResult.rows[0];

            if (!order) {

                return res.status(404).json({
                    message:
                        "Order not found."
                });

            }

            if (
                order.payment_status ===
                "Payment Confirmed"
            ) {

                return res.status(400).json({
                    message:
                        "This payment has already been confirmed."
                });

            }

            await pool.query(`
                UPDATE orders
                SET
                    payment_reference = $1,
                    payment_status = 'Payment Submitted'
                WHERE id = $2
                AND user_id = $3
            `, [

                String(
                    paymentReference
                ).trim(),

                req.params.id,
                userId

            ]);

            res.json({

                message:
                    "Payment details submitted successfully.",

                paymentStatus:
                    "Payment Submitted"

            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                message:
                    "Could not submit payment details."
            });

        }

    }
);

/* =====================================================
ADMIN — GET ALL ORDERS
===================================================== */

app.get(
    "/api/admin/orders",
    requireAdmin,
    async (req, res) => {

        try {

            const ordersResult =
                await pool.query(`
                    SELECT
                        id,
                        order_number,
                        user_id,
                        customer_name,
                        customer_email,
                        customer_phone,
                        delivery_address,
                        city,
                        total,
                        status,
                        payment_method,
                        payment_status,
                        payment_reference,
                        created_at
                    FROM orders
                    ORDER BY id DESC
                `);

            const orders =
                ordersResult.rows;

            const ordersWithItems = [];

            for (const order of orders) {

                const itemsResult =
                    await pool.query(`
                        SELECT
                            id,
                            product_id,
                            product_name,
                            price,
                            quantity,
                            selected_options,
                            variant_key,
                            product_image
                        FROM order_items
                        WHERE order_id = $1
                    `, [
                        order.id
                    ]);

                ordersWithItems.push({

                    ...order,

                    items:
                        itemsResult.rows

                });

            }

            res.json(
                ordersWithItems
            );

        } catch (error) {

            console.error(error);

            res.status(500).json({
                message:
                    "Could not load admin orders."
            });

        }

    }
);

/* =====================================================
ADMIN — GET ALL USERS
===================================================== */

app.get(
    "/api/admin/users",
    requireAdmin,
    async (req, res) => {

        try {

            const result =
                await pool.query(`
                    SELECT
                        id,
                        name,
                        email,
                        phone,
                        role,
                        created_at
                    FROM users
                    ORDER BY id DESC
                `);

            res.json(
                result.rows
            );

        } catch (error) {

            console.error(error);

            res.status(500).json({
                message:
                    "Could not load users."
            });

        }

    }
);

/* =====================================================
ADMIN — GET DASHBOARD SUMMARY
===================================================== */

app.get(
    "/api/admin/dashboard",
    requireAdmin,
    async (req, res) => {

        try {

            const totalOrdersResult =
                await pool.query(`
                    SELECT COUNT(*) AS count
                    FROM orders
                `);

            const totalCustomersResult =
                await pool.query(`
                    SELECT COUNT(*) AS count
                    FROM users
                    WHERE role = 'customer'
                `);

            const totalProductsResult =
                await pool.query(`
                    SELECT COUNT(*) AS count
                    FROM products
                `);

            const totalSalesResult =
                await pool.query(`
                    SELECT
                        COALESCE(
                            SUM(total),
                            0
                        ) AS total
                    FROM orders
                    WHERE payment_status =
                        'Payment Confirmed'
                `);

            const pendingOrdersResult =
                await pool.query(`
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE status =
                        'Order Received'
                `);

            const pendingPaymentsResult =
                await pool.query(`
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE payment_status IN (
                        'Payment Pending',
                        'Payment Submitted'
                    )
                `);

            res.json({

                totalOrders:
                    Number(
                        totalOrdersResult
                            .rows[0]
                            .count
                    ),

                totalCustomers:
                    Number(
                        totalCustomersResult
                            .rows[0]
                            .count
                    ),

                totalProducts:
                    Number(
                        totalProductsResult
                            .rows[0]
                            .count
                    ),

                totalSales:
                    Number(
                        totalSalesResult
                            .rows[0]
                            .total
                    ),

                pendingOrders:
                    Number(
                        pendingOrdersResult
                            .rows[0]
                            .count
                    ),

                pendingPayments:
                    Number(
                        pendingPaymentsResult
                            .rows[0]
                            .count
                    )

            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                message:
                    "Could not load dashboard information."
            });

        }

    }
);

/* =====================================================
ADMIN — CONFIRM PAYMENT
===================================================== */

app.patch(
    "/api/admin/orders/:id/payment",
    requireAdmin,
    async (req, res) => {

        try {

            const orderResult =
                await pool.query(`
                    SELECT
                        id,
                        order_number,
                        payment_status
                    FROM orders
                    WHERE id = $1
                `, [
                    req.params.id
                ]);

            const order =
                orderResult.rows[0];

            if (!order) {

                return res.status(404).json({
                    message:
                        "Order not found."
                });

            }

            await pool.query(`
                UPDATE orders
                SET payment_status =
                    'Payment Confirmed'
                WHERE id = $1
            `, [
                req.params.id
            ]);

            res.json({

                message:
                    "Payment confirmed successfully.",

                paymentStatus:
                    "Payment Confirmed",

                orderId:
                    order.id,

                orderNumber:
                    order.order_number

            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                message:
                    "Could not confirm payment."
            });

        }

    }
);

/* =====================================================
ADMIN — MARK PAYMENT FAILED
===================================================== */

app.patch(
    "/api/admin/orders/:id/payment-failed",
    requireAdmin,
    async (req, res) => {

        try {

            const orderResult =
                await pool.query(`
                    SELECT
                        id,
                        order_number
                    FROM orders
                    WHERE id = $1
                `, [
                    req.params.id
                ]);

            const order =
                orderResult.rows[0];

            if (!order) {

                return res.status(404).json({
                    message:
                        "Order not found."
                });

            }

            await pool.query(`
                UPDATE orders
                SET payment_status =
                    'Payment Failed'
                WHERE id = $1
            `, [
                req.params.id
            ]);

            res.json({

                message:
                    "Payment marked as failed.",

                paymentStatus:
                    "Payment Failed",

                orderId:
                    order.id,

                orderNumber:
                    order.order_number

            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                message:
                    "Could not mark payment as failed."
            });

        }

    }
);

/* =====================================================
ADMIN — ADD PRODUCT
===================================================== */

app.post(
    "/api/admin/products",
    requireAdmin,
    async (req, res) => {

        const {
            name,
            price,
            category,
            emoji,
            description,
            image,
            options,
            stock,
            variantStock
        } = req.body;

        if (
            !name ||
            price === undefined ||
            !category
        ) {

            return res.status(400).json({
                message:
                    "Product name, price and category are required."
            });

        }

        const productPrice =
            Number(price);

        if (
            !Number.isFinite(productPrice) ||
            productPrice < 0
        ) {

            return res.status(400).json({
                message:
                    "Please enter a valid product price."
            });

        }

        let cleanedOptions;
        let cleanedStock;
        let cleanedVariantStock;

        try {

            cleanedOptions =
                cleanProductOptions(
                    options
                );

            cleanedStock =
                cleanStock(
                    stock
                );

            cleanedVariantStock =
                cleanVariantStock(
                    variantStock
                );

        } catch (error) {

            return res.status(400).json({
                message:
                    error.message
            });

        }

        try {

            const result =
                await pool.query(`
                    INSERT INTO products (
                        name,
                        price,
                        category,
                        emoji,
                        description,
                        image,
                        options,
                        stock,
                        variant_stock
                    )
                    VALUES (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        $7::jsonb,
                        $8,
                        $9::jsonb
                    )
                    RETURNING
                        id,
                        name,
                        price,
                        category,
                        emoji,
                        description,
                        image,
                        options,
                        stock,
                        variant_stock
                `, [

                    name.trim(),

                    Math.round(
                        productPrice
                    ),

                    category.trim(),

                    emoji || "",

                    description || "",

                    image || "",

                    JSON.stringify(
                        cleanedOptions
                    ),

                    cleanedStock,

                    JSON.stringify(
                        cleanedVariantStock
                    )

                ]);

            res.status(201).json({

                message:
                    "Product added successfully!",

                product:
                    result.rows[0]

            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                message:
                    "Could not add product."
            });

        }

    }
);

/* =====================================================
ADMIN — UPDATE PRODUCT
===================================================== */

app.patch(
    "/api/admin/products/:id",
    requireAdmin,
    async (req, res) => {

        const {
            name,
            price,
            category,
            emoji,
            description,
            image,
            options,
            stock,
            variantStock
        } = req.body;

        if (
            !name ||
            price === undefined ||
            !category
        ) {

            return res.status(400).json({
                message:
                    "Product name, price and category are required."
            });

        }

        const productPrice =
            Number(price);

        if (
            !Number.isFinite(productPrice) ||
            productPrice < 0
        ) {

            return res.status(400).json({
                message:
                    "Please enter a valid product price."
            });

        }

        let cleanedOptions;
        let cleanedStock;
        let cleanedVariantStock;

        try {

            cleanedOptions =
                cleanProductOptions(
                    options
                );

            cleanedStock =
                cleanStock(
                    stock
                );

            cleanedVariantStock =
                cleanVariantStock(
                    variantStock
                );

        } catch (error) {

            return res.status(400).json({
                message:
                    error.message
            });

        }

        try {

            const existingProductResult =
                await pool.query(`
                    SELECT id
                    FROM products
                    WHERE id = $1
                `, [
                    req.params.id
                ]);

            const existingProduct =
                existingProductResult.rows[0];

            if (!existingProduct) {

                return res.status(404).json({
                    message:
                        "Product not found."
                });

            }

            await pool.query(`
                UPDATE products
                SET
                    name = $1,
                    price = $2,
                    category = $3,
                    emoji = $4,
                    description = $5,
                    image = $6,
                    options = $7::jsonb,
                    stock = $8,
                    variant_stock = $9::jsonb
                WHERE id = $10
            `, [

                name.trim(),

                Math.round(
                    productPrice
                ),

                category.trim(),

                emoji || "",

                description || "",

                image || "",

                JSON.stringify(
                    cleanedOptions
                ),

                cleanedStock,

                JSON.stringify(
                    cleanedVariantStock
                ),

                req.params.id

            ]);

            const productResult =
                await pool.query(`
                    SELECT
                        id,
                        name,
                        price,
                        category,
                        emoji,
                        description,
                        image,
                        options,
                        stock,
                        variant_stock
                    FROM products
                    WHERE id = $1
                `, [
                    req.params.id
                ]);

            res.json({

                message:
                    "Product updated successfully!",

                product:
                    productResult.rows[0]

            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                message:
                    "Could not update product."
            });

        }

    }
);

/* =====================================================
ADMIN — DELETE PRODUCT
===================================================== */

app.delete(
    "/api/admin/products/:id",
    requireAdmin,
    async (req, res) => {

        try {

            const productResult =
                await pool.query(`
                    SELECT
                        id,
                        name
                    FROM products
                    WHERE id = $1
                `, [
                    req.params.id
                ]);

            const product =
                productResult.rows[0];

            if (!product) {

                return res.status(404).json({
                    message:
                        "Product not found."
                });

            }

            const usedInOrdersResult =
                await pool.query(`
                    SELECT COUNT(*) AS count
                    FROM order_items
                    WHERE product_id = $1
                `, [
                    req.params.id
                ]);

            const usedInOrders =
                Number(
                    usedInOrdersResult
                        .rows[0]
                        .count
                );

            if (usedInOrders > 0) {

                return res.status(409).json({
                    message:
                        "This product cannot be deleted because it is already part of an order."
                });

            }

            await pool.query(`
                DELETE FROM products
                WHERE id = $1
            `, [
                req.params.id
            ]);

            res.json({

                message:
                    "Product deleted successfully!",

                productId:
                    Number(req.params.id)

            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                message:
                    "Could not delete product."
            });

        }

    }
);

/* =====================================================
ADMIN — UPDATE ORDER STATUS
===================================================== */

app.patch(
    "/api/admin/orders/:id/status",
    requireAdmin,
    async (req, res) => {

        const {
            status
        } = req.body;

        const allowedStatuses = [

            "Order Received",

            "Processing",

            "Shipped",

            "Out for Delivery",

            "Delivered",

            "Cancelled"

        ];

        if (
            !allowedStatuses.includes(status)
        ) {

            return res.status(400).json({

                message:
                    "Invalid order status."

            });

        }

        try {

            const result =
                await pool.query(`
                    UPDATE orders
                    SET status = $1
                    WHERE id = $2
                    RETURNING id
                `, [

                    status,
                    req.params.id

                ]);

            if (
                result.rows.length === 0
            ) {

                return res.status(404).json({
                    message:
                        "Order not found."
                });

            }

            res.json({

                message:
                    "Order status updated successfully.",

                status:
                    status

            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                message:
                    "Could not update order status."
            });

        }

    }
);

/* =====================================================
MULTER ERROR HANDLER
===================================================== */

app.use(
    (error, req, res, next) => {

        if (
            error instanceof multer.MulterError
        ) {

            if (
                error.code ===
                "LIMIT_FILE_SIZE"
            ) {

                return res.status(400).json({
                    message:
                        "Image is too large. Maximum size is 5MB."
                });

            }

            return res.status(400).json({
                message:
                    "Image upload error."
            });

        }

        if (error) {

            if (
                error.message ===
                "Only image files are allowed."
            ) {

                return res.status(400).json({
                    message:
                        error.message
                });

            }

            console.error(error);

            return res.status(500).json({
                message:
                    "Something went wrong."
            });

        }

        next(error);

    }
);
