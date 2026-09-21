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

            cleanedValues.push({

                name:
                    valueName,

                price:
                    valuePrice,

                image:
                    valueImage

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
       NEW PRODUCT OPTIONS COLUMN

       Existing products automatically receive [].
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
                    COALESCE(options, '[]'::jsonb) AS options
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

            let total = 0;

            const orderItems = [];

            for (const item of items) {

                if (
                    !item.productId ||
                    !item.quantity ||
                    Number(item.quantity) < 1
                ) {

                    return res.status(400).json({
                        message:
                            "Invalid order item."
                    });

                }

                const productResult =
                    await client.query(`
                        SELECT
                            id,
                            name,
                            price
                        FROM products
                        WHERE id = $1
                    `, [
                        item.productId
                    ]);

                const product =
                    productResult.rows[0];

                if (!product) {

                    return res.status(404).json({
                        message:
                            "Product not found."
                    });

                }

                const quantity =
                    Number(item.quantity);

                total +=
                    Number(product.price) *
                    quantity;

                orderItems.push({

                    productId:
                        product.id,

                    productName:
                        product.name,

                    price:
                        Number(product.price),

                    quantity:
                        quantity

                });

            }

            const orderNumber =
                "KM" +
                Date.now()
                    .toString()
                    .slice(-8);

            await client.query(
                "BEGIN"
            );

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
                    paymentMethod || "Bank Transfer",
                    "Payment Pending"

                ]);

            const orderId =
                orderResult.rows[0].id;

            for (const item of orderItems) {

                await client.query(`
                    INSERT INTO order_items (
                        order_id,
                        product_id,
                        product_name,
                        price,
                        quantity
                    )
                    VALUES ($1, $2, $3, $4, $5)
                `, [

                    orderId,
                    item.productId,
                    item.productName,
                    item.price,
                    item.quantity

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

            console.error(error);

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
                            quantity
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
                        quantity
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
                            quantity
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
            options
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

        try {

            cleanedOptions =
                cleanProductOptions(
                    options
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
                        options
                    )
                    VALUES (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        $7::jsonb
                    )
                    RETURNING
                        id,
                        name,
                        price,
                        category,
                        emoji,
                        description,
                        image,
                        options
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
            options
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

        try {

            cleanedOptions =
                cleanProductOptions(
                    options
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
                    options = $7::jsonb
                WHERE id = $8
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
                        options
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

        next();

    }
);
