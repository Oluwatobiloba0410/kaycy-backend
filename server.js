const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const db = new Database("kaycy.db");


/* =====================================================
USERS TABLE
===================================================== */

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'customer',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);


/* =====================================================
ADD ROLE TO OLD DATABASE
===================================================== */

let userColumns =
    db.prepare(
        "PRAGMA table_info(users)"
    ).all();

if (
    !userColumns.some(
        column =>
            column.name === "role"
    )
) {

    db.exec(`
        ALTER TABLE users
        ADD COLUMN role TEXT NOT NULL DEFAULT 'customer'
    `);

}


/* =====================================================
PRODUCTS TABLE
===================================================== */

db.exec(`
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price INTEGER NOT NULL,
        category TEXT NOT NULL,
        emoji TEXT,
        description TEXT,
        image TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);


/* =====================================================
ADD ACTIVE COLUMN TO OLD PRODUCTS TABLE
===================================================== */

let productColumns =
    db.prepare(
        "PRAGMA table_info(products)"
    ).all();

if (
    !productColumns.some(
        column =>
            column.name === "active"
    )
) {

    db.exec(`
        ALTER TABLE products
        ADD COLUMN active INTEGER NOT NULL DEFAULT 1
    `);

}


/* =====================================================
ORDERS TABLE
===================================================== */

db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);


/* =====================================================
ADD NEW COLUMNS TO OLD ORDERS TABLE
===================================================== */

let orderColumns =
    db.prepare(
        "PRAGMA table_info(orders)"
    ).all();

if (
    !orderColumns.some(
        column =>
            column.name === "delivery_address"
    )
) {

    db.exec(`
        ALTER TABLE orders
        ADD COLUMN delivery_address TEXT
    `);

}


orderColumns =
    db.prepare(
        "PRAGMA table_info(orders)"
    ).all();

if (
    !orderColumns.some(
        column =>
            column.name === "city"
    )
) {

    db.exec(`
        ALTER TABLE orders
        ADD COLUMN city TEXT
    `);

}


/* =====================================================
ADD PAYMENT STATUS
===================================================== */

orderColumns =
    db.prepare(
        "PRAGMA table_info(orders)"
    ).all();

if (
    !orderColumns.some(
        column =>
            column.name === "payment_status"
    )
) {

    db.exec(`
        ALTER TABLE orders
        ADD COLUMN payment_status TEXT
        NOT NULL DEFAULT 'Payment Pending'
    `);

}


/* =====================================================
ADD PAYMENT REFERENCE
===================================================== */

orderColumns =
    db.prepare(
        "PRAGMA table_info(orders)"
    ).all();

if (
    !orderColumns.some(
        column =>
            column.name === "payment_reference"
    )
) {

    db.exec(`
        ALTER TABLE orders
        ADD COLUMN payment_reference TEXT
    `);

}


/* =====================================================
ORDER ITEMS TABLE
===================================================== */

db.exec(`
    CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        product_id INTEGER,
        product_name TEXT NOT NULL,
        price INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        FOREIGN KEY(order_id)
            REFERENCES orders(id),
        FOREIGN KEY(product_id)
            REFERENCES products(id)
    )
`);


/* =====================================================
HOME / TEST ROUTE
===================================================== */

app.get("/", (req, res) => {

    res.send(
        "Kaycy Mart backend and database are working! 🛒🔥"
    );

});


/* =====================================================
ADMIN CHECK MIDDLEWARE
===================================================== */

function requireAdmin(
    req,
    res,
    next
) {

    const adminId =
        req.headers[
            "x-admin-user-id"
        ];


    if (!adminId) {

        return res.status(401).json({

            message:
                "Admin login is required."

        });

    }


    try {

        const admin =
            db.prepare(`
                SELECT
                    id,
                    name,
                    email,
                    role
                FROM users
                WHERE id = ?
            `).get(
                adminId
            );


        if (!admin) {

            return res.status(401).json({

                message:
                    "Admin account could not be verified."

            });

        }


        if (
            String(
                admin.role
            ).toLowerCase() !== "admin"
        ) {

            return res.status(403).json({

                message:
                    "Access denied. Admin permission required."

            });

        }


        req.admin =
            admin;


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
GET ACTIVE PRODUCTS — CUSTOMER STORE
===================================================== */

app.get(
    "/api/products",
    (req, res) => {

        try {

            const products =
                db.prepare(`
                    SELECT
                        id,
                        name,
                        price,
                        category,
                        emoji,
                        description,
                        image,
                        active
                    FROM products
                    WHERE active = 1
                    ORDER BY id ASC
                `).all();


            res.json(
                products
            );


        } catch (error) {

            console.error(error);

            res.status(500).json({

                message:
                    "Could not load products."

            });

        }

    }
);


/* =====================================================
ADMIN — GET ALL PRODUCTS
===================================================== */

app.get(
    "/api/admin/products",
    requireAdmin,
    (req, res) => {

        try {

            const products =
                db.prepare(`
                    SELECT
                        id,
                        name,
                        price,
                        category,
                        emoji,
                        description,
                        image,
                        active,
                        created_at
                    FROM products
                    ORDER BY id DESC
                `).all();


            res.json(
                products
            );


        } catch (error) {

            console.error(error);

            res.status(500).json({

                message:
                    "Could not load admin products."

            });

        }

    }
);


/* =====================================================
REGISTER
===================================================== */

app.post(
    "/api/register",
    async (req, res) => {

        const {
            name,
            email,
            phone,
            password
        } = req.body;


        if (
            !name ||
            !email ||
            !password
        ) {

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


            const stmt =
                db.prepare(`
                    INSERT INTO users
                    (
                        name,
                        email,
                        phone,
                        password
                    )
                    VALUES (?, ?, ?, ?)
                `);


            const result =
                stmt.run(

                    name.trim(),

                    email.trim(),

                    phone
                        ? phone.trim()
                        : null,

                    hashedPassword

                );


            res.status(201).json({

                message:
                    "Account created successfully!",

                userId:
                    result.lastInsertRowid

            });


        } catch (error) {

            if (
                error.code ===
                "SQLITE_CONSTRAINT_UNIQUE"
            ) {

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

    }
);


/* =====================================================
LOGIN
===================================================== */

app.post(
    "/api/login",
    async (req, res) => {

        const {
            email,
            password
        } = req.body;


        if (
            !email ||
            !password
        ) {

            return res.status(400).json({

                message:
                    "Please enter your email and password."

            });

        }


        try {

            const user =
                db.prepare(`
                    SELECT
                        id,
                        name,
                        email,
                        phone,
                        password,
                        role
                    FROM users
                    WHERE LOWER(email) = LOWER(?)
                `).get(
                    email.trim()
                );


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

    }
);


/* =====================================================
FORGOT PASSWORD
===================================================== */

app.post(
    "/api/forgot-password",
    (req, res) => {

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

            const user =
                db.prepare(`
                    SELECT
                        id,
                        email
                    FROM users
                    WHERE LOWER(email) = LOWER(?)
                `).get(
                    email.trim()
                );


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


        if (
            !email ||
            !newPassword
        ) {

            return res.status(400).json({

                message:
                    "Email and new password are required."

            });

        }


        if (
            newPassword.length < 6
        ) {

            return res.status(400).json({

                message:
                    "Password must be at least 6 characters."

            });

        }


        try {

            const user =
                db.prepare(`
                    SELECT
                        id
                    FROM users
                    WHERE LOWER(email) = LOWER(?)
                `).get(
                    email.trim()
                );


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


            db.prepare(`
                UPDATE users
                SET password = ?
                WHERE id = ?
            `).run(

                hashedPassword,

                user.id

            );


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
    (req, res) => {

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


        if (
            !deliveryAddress ||
            !city
        ) {

            return res.status(400).json({

                message:
                    "Delivery address and city are required."

            });

        }


        try {

            const user =
                db.prepare(`
                    SELECT id
                    FROM users
                    WHERE id = ?
                `).get(
                    userId
                );


            if (!user) {

                return res.status(401).json({

                    message:
                        "User account could not be verified."

                });

            }


            let total = 0;

            const orderItems = [];


            for (
                const item
                of items
            ) {

                if (
                    !item.productId ||
                    !item.quantity ||
                    Number(
                        item.quantity
                    ) < 1
                ) {

                    return res.status(400).json({

                        message:
                            "Invalid order item."

                    });

                }


                const product =
                    db.prepare(`
                        SELECT
                            id,
                            name,
                            price,
                            active
                        FROM products
                        WHERE id = ?
                    `).get(
                        item.productId
                    );


                if (!product) {

                    return res.status(404).json({

                        message:
                            "Product not found."

                    });

                }


                if (
                    Number(
                        product.active
                    ) !== 1
                ) {

                    return res.status(409).json({

                        message:
                            "One of the products in your cart is no longer available."

                    });

                }


                const quantity =
                    Number(
                        item.quantity
                    );


                total +=
                    product.price *
                    quantity;


                orderItems.push({

                    productId:
                        product.id,

                    productName:
                        product.name,

                    price:
                        product.price,

                    quantity:
                        quantity

                });

            }


            const orderNumber =
                "KM" +
                Date.now()
                    .toString()
                    .slice(-8);


            const createOrder =
                db.transaction(
                    () => {

                        const orderResult =
                            db.prepare(`
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
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            `).run(

                                orderNumber,

                                userId,

                                customerName,

                                customerEmail ||
                                    null,

                                customerPhone ||
                                    null,

                                deliveryAddress,

                                city,

                                total,

                                "Order Received",

                                paymentMethod ||
                                    "Bank Transfer",

                                "Payment Pending"

                            );


                        const orderId =
                            orderResult.lastInsertRowid;


                        const itemStatement =
                            db.prepare(`
                                INSERT INTO order_items (
                                    order_id,
                                    product_id,
                                    product_name,
                                    price,
                                    quantity
                                )
                                VALUES (?, ?, ?, ?, ?)
                            `);


                        for (
                            const item
                            of orderItems
                        ) {

                            itemStatement.run(

                                orderId,

                                item.productId,

                                item.productName,

                                item.price,

                                item.quantity

                            );

                        }


                        return orderId;

                    }
                );


            const orderId =
                createOrder();


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

            console.error(error);

            res.status(500).json({

                message:
                    "Could not create order."

            });

        }

    }
);


/* =====================================================
GET USER ORDERS
===================================================== */

app.get(
    "/api/orders",
    (req, res) => {

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

            const orders =
                db.prepare(`
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
                    WHERE user_id = ?
                    ORDER BY id DESC
                `).all(
                    userId
                );


            const getItems =
                db.prepare(`
                    SELECT
                        id,
                        product_id,
                        product_name,
                        price,
                        quantity
                    FROM order_items
                    WHERE order_id = ?
                `);


            const ordersWithItems =
                orders.map(
                    order => ({

                        ...order,

                        items:
                            getItems.all(
                                order.id
                            )

                    })
                );


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
    (req, res) => {

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

            const order =
                db.prepare(`
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
                    WHERE id = ?
                    AND user_id = ?
                `).get(
                    req.params.id,
                    userId
                );


            if (!order) {

                return res.status(404).json({

                    message:
                        "Order not found."

                });

            }


            const items =
                db.prepare(`
                    SELECT
                        id,
                        product_id,
                        product_name,
                        price,
                        quantity
                    FROM order_items
                    WHERE order_id = ?
                `).all(
                    req.params.id
                );


            res.json({

                order:
                    order,

                items:
                    items

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
    (req, res) => {

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
            !String(
                paymentReference
            ).trim()
        ) {

            return res.status(400).json({

                message:
                    "Payment reference is required."

            });

        }


        try {

            const order =
                db.prepare(`
                    SELECT
                        id,
                        user_id,
                        payment_status
                    FROM orders
                    WHERE id = ?
                    AND user_id = ?
                `).get(

                    req.params.id,

                    userId

                );


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


            db.prepare(`
                UPDATE orders
                SET
                    payment_reference = ?,
                    payment_status =
                        'Payment Submitted'
                WHERE id = ?
                AND user_id = ?
            `).run(

                String(
                    paymentReference
                ).trim(),

                req.params.id,

                userId

            );


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
    (req, res) => {

        try {

            const orders =
                db.prepare(`
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
                `).all();


            const getItems =
                db.prepare(`
                    SELECT
                        id,
                        product_id,
                        product_name,
                        price,
                        quantity
                    FROM order_items
                    WHERE order_id = ?
                `);


            const ordersWithItems =
                orders.map(
                    order => ({

                        ...order,

                        items:
                            getItems.all(
                                order.id
                            )

                    })
                );


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
    (req, res) => {

        try {

            const users =
                db.prepare(`
                    SELECT
                        id,
                        name,
                        email,
                        phone,
                        role,
                        created_at
                    FROM users
                    ORDER BY id DESC
                `).all();


            res.json(
                users
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
ADMIN — DASHBOARD
===================================================== */

app.get(
    "/api/admin/dashboard",
    requireAdmin,
    (req, res) => {

        try {

            const totalOrders =
                db.prepare(`
                    SELECT COUNT(*) AS count
                    FROM orders
                `).get().count;


            const totalCustomers =
                db.prepare(`
                    SELECT COUNT(*) AS count
                    FROM users
                    WHERE role = 'customer'
                `).get().count;


            const totalProducts =
                db.prepare(`
                    SELECT COUNT(*) AS count
                    FROM products
                `).get().count;


            const totalSales =
                db.prepare(`
                    SELECT
                        COALESCE(
                            SUM(total),
                            0
                        ) AS total
                    FROM orders
                    WHERE payment_status =
                        'Payment Confirmed'
                `).get().total;


            const pendingOrders =
                db.prepare(`
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE status =
                        'Order Received'
                `).get().count;


            const pendingPayments =
                db.prepare(`
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE payment_status IN (
                        'Payment Pending',
                        'Payment Submitted'
                    )
                `).get().count;


            res.json({

                totalOrders:
                    totalOrders,

                totalCustomers:
                    totalCustomers,

                totalProducts:
                    totalProducts,

                totalSales:
                    totalSales,

                pendingOrders:
                    pendingOrders,

                pendingPayments:
                    pendingPayments

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
    (req, res) => {

        try {

            const order =
                db.prepare(`
                    SELECT
                        id,
                        order_number,
                        payment_status
                    FROM orders
                    WHERE id = ?
                `).get(
                    req.params.id
                );


            if (!order) {

                return res.status(404).json({

                    message:
                        "Order not found."

                });

            }


            db.prepare(`
                UPDATE orders
                SET
                    payment_status =
                        'Payment Confirmed'
                WHERE id = ?
            `).run(
                req.params.id
            );


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
ADMIN — PAYMENT FAILED
===================================================== */

app.patch(
    "/api/admin/orders/:id/payment-failed",
    requireAdmin,
    (req, res) => {

        try {

            const order =
                db.prepare(`
                    SELECT
                        id,
                        order_number
                    FROM orders
                    WHERE id = ?
                `).get(
                    req.params.id
                );


            if (!order) {

                return res.status(404).json({

                    message:
                        "Order not found."

                });

            }


            db.prepare(`
                UPDATE orders
                SET
                    payment_status =
                        'Payment Failed'
                WHERE id = ?
            `).run(
                req.params.id
            );


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
                    "Could not update payment status."

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
    (req, res) => {

        const {
            name,
            price,
            category,
            emoji,
            description,
            image
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
            !Number.isFinite(
                productPrice
            ) ||
            productPrice < 0
        ) {

            return res.status(400).json({

                message:
                    "Please enter a valid product price."

            });

        }


        try {

            const result =
                db.prepare(`
                    INSERT INTO products (
                        name,
                        price,
                        category,
                        emoji,
                        description,
                        image,
                        active
                    )
                    VALUES (?, ?, ?, ?, ?, ?, 1)
                `).run(

                    name.trim(),

                    Math.round(
                        productPrice
                    ),

                    category.trim(),

                    emoji || "",

                    description || "",

                    image || ""

                );


            const product =
                db.prepare(`
                    SELECT
                        id,
                        name,
                        price,
                        category,
                        emoji,
                        description,
                        image,
                        active
                    FROM products
                    WHERE id = ?
                `).get(
                    result.lastInsertRowid
                );


            res.status(201).json({

                message:
                    "Product added successfully!",

                product:
                    product

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
    (req, res) => {

        const {
            name,
            price,
            category,
            emoji,
            description,
            image
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
            !Number.isFinite(
                productPrice
            ) ||
            productPrice < 0
        ) {

            return res.status(400).json({

                message:
                    "Please enter a valid product price."

            });

        }


        try {

            const existingProduct =
                db.prepare(`
                    SELECT
                        id,
                        active
                    FROM products
                    WHERE id = ?
                `).get(
                    req.params.id
                );


            if (!existingProduct) {

                return res.status(404).json({

                    message:
                        "Product not found."

                });

            }


            db.prepare(`
                UPDATE products
                SET
                    name = ?,
                    price = ?,
                    category = ?,
                    emoji = ?,
                    description = ?,
                    image = ?
                WHERE id = ?
            `).run(

                name.trim(),

                Math.round(
                    productPrice
                ),

                category.trim(),

                emoji || "",

                description || "",

                image || "",

                req.params.id

            );


            const product =
                db.prepare(`
                    SELECT
                        id,
                        name,
                        price,
                        category,
                        emoji,
                        description,
                        image,
                        active
                    FROM products
                    WHERE id = ?
                `).get(
                    req.params.id
                );


            res.json({

                message:
                    "Product updated successfully!",

                product:
                    product

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
ADMIN — HIDE / SHOW PRODUCT
===================================================== */

app.patch(
    "/api/admin/products/:id/visibility",
    requireAdmin,
    (req, res) => {

        try {

            const product =
                db.prepare(`
                    SELECT
                        id,
                        name,
                        active
                    FROM products
                    WHERE id = ?
                `).get(
                    req.params.id
                );


            if (!product) {

                return res.status(404).json({

                    message:
                        "Product not found."

                });

            }


            const newActive =
                Number(
                    product.active
                ) === 1
                    ? 0
                    : 1;


            db.prepare(`
                UPDATE products
                SET active = ?
                WHERE id = ?
            `).run(

                newActive,

                req.params.id

            );


            res.json({

                message:
                    newActive === 1
                        ? "Product is now visible in the store."
                        : "Product has been hidden from the store.",

                active:
                    newActive,

                productId:
                    Number(
                        req.params.id
                    )

            });


        } catch (error) {

            console.error(error);

            res.status(500).json({

                message:
                    "Could not change product visibility."

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
    (req, res) => {

        try {

            const product =
                db.prepare(`
                    SELECT
                        id,
                        name
                    FROM products
                    WHERE id = ?
                `).get(
                    req.params.id
                );


            if (!product) {

                return res.status(404).json({

                    message:
                        "Product not found."

                });

            }


            const usedInOrders =
                db.prepare(`
                    SELECT
                        COUNT(*) AS count
                    FROM order_items
                    WHERE product_id = ?
                `).get(
                    req.params.id
                ).count;


            if (
                usedInOrders > 0
            ) {

                return res.status(409).json({

                    message:
                        "This product cannot be deleted because it is already part of an order."

                });

            }


            db.prepare(`
                DELETE FROM products
                WHERE id = ?
            `).run(
                req.params.id
            );


            res.json({

                message:
                    "Product deleted successfully!",

                productId:
                    Number(
                        req.params.id
                    )

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
    (req, res) => {

        const {
            status
        } = req.body;


        const allowedStatuses = [

            "Order Received",

            "Processing",

            "Shipped",

            "Delivered",

            "Cancelled"

        ];


        if (
            !allowedStatuses.includes(
                status
            )
        ) {

            return res.status(400).json({

                message:
                    "Invalid order status."

            });

        }


        try {

            const result =
                db.prepare(`
                    UPDATE orders
                    SET status = ?
                    WHERE id = ?
                `).run(

                    status,

                    req.params.id

                );


            if (
                result.changes === 0
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
ONE-TIME ADMIN ACCOUNT SETUP
===================================================== */

app.post(
    "/api/setup-admin",
    async (req, res) => {

        const {
            setupKey,
            name,
            email,
            password
        } = req.body;


        if (
            !process.env.ADMIN_SETUP_KEY ||
            setupKey !== process.env.ADMIN_SETUP_KEY
        ) {

            return res.status(403).json({

                message:
                    "Invalid admin setup key."

            });

        }


        if (
            !name ||
            !email ||
            !password
        ) {

            return res.status(400).json({

                message:
                    "Name, email and password are required."

            });

        }


        if (
            password.length < 6
        ) {

            return res.status(400).json({

                message:
                    "Password must be at least 6 characters."

            });

        }


        try {

            const cleanEmail =
                email.trim().toLowerCase();


            const existingUser =
                db.prepare(`
                    SELECT
                        id,
                        email,
                        role
                    FROM users
                    WHERE LOWER(email) = LOWER(?)
                `).get(
                    cleanEmail
                );


            const hashedPassword =
                await bcrypt.hash(
                    password,
                    10
                );


            if (existingUser) {

                db.prepare(`
                    UPDATE users
                    SET
                        name = ?,
                        password = ?,
                        role = 'admin'
                    WHERE id = ?
                `).run(

                    name.trim(),

                    hashedPassword,

                    existingUser.id

                );


                return res.json({

                    message:
                        "Existing account has been converted to admin successfully.",

                    userId:
                        existingUser.id,

                    email:
                        cleanEmail,

                    role:
                        "admin"

                });

            }


            const result =
                db.prepare(`
                    INSERT INTO users
                    (
                        name,
                        email,
                        password,
                        role
                    )
                    VALUES (?, ?, ?, 'admin')
                `).run(

                    name.trim(),

                    cleanEmail,

                    hashedPassword

                );


            res.status(201).json({

                message:
                    "Admin account created successfully.",

                userId:
                    result.lastInsertRowid,

                email:
                    cleanEmail,

                role:
                    "admin"

            });


        } catch (error) {

            console.error(error);

            res.status(500).json({

                message:
                    "Could not create admin account."

            });

        }

    }
);


/* =====================================================
START SERVER
===================================================== */

app.listen(
    PORT,
    () => {

        console.log(
            `Kaycy Mart server is running on port ${PORT}`
        );

    }
);
