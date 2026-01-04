const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const dotenv = require("dotenv");
dotenv.config();
const admin = require("firebase-admin");

const uri = process.env.URI;
// index.js
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//middlewares
app.use(cors());
app.use(express.json());

const verifyFirebaseToken = async (req, res, next) => {
  console.log("in the verify middleware", req.headers.authorization);
  if (!req.headers.authorization) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  const token = req.headers.authorization.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  try {
    const userInfo = await admin.auth().verifyIdToken(token);
    req.user = userInfo;
    next();
  } catch {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const verifyAdmin = async (req, res, next) => {
  try {
    // First verify the Firebase token
    if (!req.user) {
      return res.status(401).send({ message: "unauthorized access" });
    }

    // Then check if user has admin role in database
    const user = await client.db("rentalwheels").collection("users").findOne({
      uid: req.user.uid,
    });

    if (!user || user.role !== "admin") {
      return res
        .status(403)
        .send({ message: "forbidden: admin access required" });
    }

    next();
  } catch (error) {
    return res.status(500).send({ message: "error verifying admin status" });
  }
};
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    const db = client.db("rentalwheels");
    const usersCollection = db.collection("users");
    const carsCollection = db.collection("cars");
    const bookingsCollection = db.collection("bookings");
    const reviewsCollection = db.collection("reviews");

    const updateExpiredBookings = async () => {
      const today = new Date().toISOString().split("T")[0];

      const expiredBookings = await bookingsCollection
        .find({
          endDate: { $lt: today },
          status: "Confirmed",
        })
        .toArray();

      for (const booking of expiredBookings) {
        await carsCollection.updateOne(
          { _id: new ObjectId(booking.carId) },
          { $set: { status: "Available", availability: "available" } }
        );

        await bookingsCollection.updateOne(
          { _id: booking._id },
          { $set: { status: "Completed" } }
        );
      }

      if (expiredBookings.length > 0) {
        console.log(`Updated ${expiredBookings.length} expired bookings`);
      }
    };

    setInterval(updateExpiredBookings, 24 * 60 * 60 * 1000);
    updateExpiredBookings();

    //users api
    // Public
    app.get("/users", async (req, res) => {
      const cursor = usersCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    // Public
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { uid: user.uid };

      // Check if user already exists
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "User exists", user: existingUser });
      }

      // If user doesn't exist, create new user
      const newUser = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        role: user.role || "user",
        createdAt: new Date(),
      };

      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });

    // Public - Get User by UID
    app.get("/users/:uid", async (req, res) => {
      const uid = req.params.uid;
      const query = { uid: uid };
      const user = await usersCollection.findOne(query);
      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }
      res.send(user);
    });

    // Private - Update User by UID
    app.patch("/users/:uid", verifyFirebaseToken, async (req, res) => {
      const uid = req.params.uid;
      const { displayName, photoURL } = req.body;

      if (uid !== req.user.uid) {
        return res
          .status(403)
          .send({ message: "Forbidden: You can only update your own profile" });
      }

      const filter = { uid: uid };
      const updateDoc = {
        $set: {
          displayName,
          photoURL,
        },
      };

      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // Private - Get User Earnings
    app.get("/users/:uid/earnings", verifyFirebaseToken, async (req, res) => {
      const uid = req.params.uid;

      if (uid !== req.user.uid) {
        return res
          .status(403)
          .send({ message: "Forbidden: You can only view your own earnings" });
      }

      const cars = await carsCollection
        .find({
          $or: [{ providerUid: uid }, { providerId: uid }],
        })
        .toArray();

      const carIds = cars.map((car) => car._id.toString());

      if (carIds.length === 0) {
        return res.send({ totalEarnings: 0 });
      }

      const bookings = await bookingsCollection
        .find({
          carId: { $in: carIds },
        })
        .toArray();

      const totalEarnings = bookings.reduce(
        (sum, booking) => sum + Number(booking.totalPrice),
        0
      );

      res.send({ totalEarnings });
    });

    // ============================================
    // ADMIN ROUTES - User Management
    // ============================================

    // Admin - Get All Users
    app.get(
      "/admin/users",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const users = await usersCollection.find().toArray();
          res.send(users);
        } catch (error) {
          res.status(500).send({ message: "Error fetching users" });
        }
      }
    );

    // Admin - Get User Statistics
    app.get(
      "/admin/users/stats",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const totalUsers = await usersCollection.countDocuments();
          const adminUsers = await usersCollection.countDocuments({
            role: "admin",
          });
          const regularUsers = await usersCollection.countDocuments({
            role: "user",
          });

          res.send({
            totalUsers,
            adminUsers,
            regularUsers,
          });
        } catch (error) {
          res.status(500).send({ message: "Error fetching user statistics" });
        }
      }
    );

    // Admin - Change User Role
    app.patch(
      "/admin/users/:uid/role",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const uid = req.params.uid;
          const { role } = req.body;

          if (!["user", "admin"].includes(role)) {
            return res
              .status(400)
              .send({ message: "Invalid role. Must be 'user' or 'admin'" });
          }

          const filter = { uid: uid };
          const updateDoc = {
            $set: { role: role },
          };

          const result = await usersCollection.updateOne(filter, updateDoc);

          if (result.matchedCount === 0) {
            return res.status(404).send({ message: "User not found" });
          }

          res.send({ message: "User role updated successfully", result });
        } catch (error) {
          res.status(500).send({ message: "Error updating user role" });
        }
      }
    );

    // ============================================
    // ADMIN ROUTES - Car Management
    // ============================================

    // Admin - Get All Cars
    app.get(
      "/admin/cars",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const cars = await carsCollection.find().toArray();

          const carsWithBookingCount = await Promise.all(
            cars.map(async (car) => {
              const bookingCount = await bookingsCollection.countDocuments({
                carId: car._id.toString(),
              });
              return { ...car, bookingCount };
            })
          );

          res.send(carsWithBookingCount);
        } catch (error) {
          console.error("Error fetching cars:", error);
          res.status(500).send({ message: "Error fetching cars" });
        }
      }
    );

    // Admin - Delete Any Car
    app.delete(
      "/admin/cars/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const query = { _id: new ObjectId(id) };
          const result = await carsCollection.deleteOne(query);

          if (result.deletedCount === 0) {
            return res.status(404).send({ message: "Car not found" });
          }

          res.send({ message: "Car deleted successfully", result });
        } catch (error) {
          res.status(500).send({ message: "Error deleting car" });
        }
      }
    );

    // Admin - Update Any Car
    app.patch(
      "/admin/cars/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const updatedData = req.body;

          const filter = { _id: new ObjectId(id) };
          const updateDoc = {
            $set: updatedData,
          };

          const result = await carsCollection.updateOne(filter, updateDoc);

          if (result.matchedCount === 0) {
            return res.status(404).send({ message: "Car not found" });
          }

          res.send({ message: "Car updated successfully", result });
        } catch (error) {
          res.status(500).send({ message: "Error updating car" });
        }
      }
    );

    // ============================================
    // ADMIN ROUTES - Booking Management
    // ============================================

    // Admin - Get All Bookings
    app.get(
      "/admin/bookings",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const bookings = await bookingsCollection.find().toArray();
          res.send(bookings);
        } catch (error) {
          console.error("Error fetching bookings:", error);
          res.status(500).send({ message: "Error fetching bookings" });
        }
      }
    );

    // Admin - Delete Any Booking
    app.delete(
      "/admin/bookings/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const query = { _id: new ObjectId(id) };
          const result = await bookingsCollection.deleteOne(query);

          if (result.deletedCount === 0) {
            return res.status(404).send({ message: "Booking not found" });
          }

          res.send({ message: "Booking deleted successfully", result });
        } catch (error) {
          res.status(500).send({ message: "Error deleting booking" });
        }
      }
    );

    // ============================================
    // ADMIN ROUTES - Platform Statistics
    // ============================================

    // Admin - Get Platform Statistics
    app.get(
      "/admin/stats",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const totalUsers = await usersCollection.countDocuments();
          const totalCars = await carsCollection.countDocuments();
          const totalBookings = await bookingsCollection.countDocuments();

          const availableCars = await carsCollection.countDocuments({
            status: "Available",
          });
          const bookedCars = await carsCollection.countDocuments({
            status: "Booked",
          });

          // Calculate total revenue
          const bookings = await bookingsCollection.find().toArray();
          const totalRevenue = bookings.reduce(
            (sum, booking) => sum + Number(booking.totalPrice || 0),
            0
          );

          // Get category distribution
          const cars = await carsCollection.find().toArray();
          const categoryMap = {};
          cars.forEach((car) => {
            const category = car.category || "Other";
            categoryMap[category] = (categoryMap[category] || 0) + 1;
          });

          const carsByCategory = Object.keys(categoryMap).map((category) => ({
            name: category,
            value: categoryMap[category],
          }));

          res.send({
            totalUsers,
            totalCars,
            totalBookings,
            availableCars,
            bookedCars,
            totalRevenue,
            carsByCategory,
          });
        } catch (error) {
          res
            .status(500)
            .send({ message: "Error fetching platform statistics" });
        }
      }
    );

    // Cars API
    // Private
    app.post("/cars", verifyFirebaseToken, async (req, res) => {
      const car = req.body;
      const result = await carsCollection.insertOne(car);
      res.send(result);
    });

    // Public
    app.get("/cars/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const car = await carsCollection.findOne(query);
      res.send(car);
    });

    app.get("/cars", async (req, res) => {
      const uid = req.query.uid;
      const searchQuery = req.query.search;

      const query = {};

      if (uid) {
        query.$or = [{ providerUid: uid }, { providerId: uid }];
      }

      if (searchQuery) {
        query.carName = { $regex: searchQuery, $options: "i" };
      }

      const cars = await carsCollection.find(query).toArray();
      res.send(cars);
    });

    // Get related cars by category
    app.get("/cars/:id/related", async (req, res) => {
      const id = req.params.id;

      try {
        const currentCar = await carsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!currentCar) {
          return res.status(404).send({ message: "Car not found" });
        }

        const relatedCars = await carsCollection
          .find({
            category: currentCar.category,
            _id: { $ne: new ObjectId(id) },
            status: "Available",
          })
          .limit(4)
          .toArray();

        res.send(relatedCars);
      } catch (error) {
        console.error("Error fetching related cars:", error);
        res.status(500).send({ message: "Error fetching related cars" });
      }
    });

    // Private
    app.put("/cars/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const updatedCar = req.body;

      const existingCar = await carsCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!existingCar) {
        return res.status(404).send({ message: "Car not found" });
      }
      if (
        existingCar.providerUid !== req.user.uid &&
        existingCar.providerId !== req.user.uid
      ) {
        return res
          .status(403)
          .send({ message: "Forbidden: You can only update your own cars" });
      }

      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: updatedCar,
      };
      const result = await carsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // Private
    app.patch("/cars/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;

      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { status },
      };
      const result = await carsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // Private
    app.delete("/cars/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;

      const existingCar = await carsCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!existingCar) {
        return res.status(404).send({ message: "Car not found" });
      }
      if (
        existingCar.providerUid !== req.user.uid &&
        existingCar.providerId !== req.user.uid
      ) {
        return res
          .status(403)
          .send({ message: "Forbidden: You can only delete your own cars" });
      }

      const query = { _id: new ObjectId(id) };
      const result = await carsCollection.deleteOne(query);
      res.send(result);
    });

    // Bookings API
    // Private
    app.post("/bookings", verifyFirebaseToken, async (req, res) => {
      const booking = req.body;
      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });

    // Private
    app.get("/bookings", verifyFirebaseToken, async (req, res) => {
      const renterId = req.query.renterId;

      if (renterId && renterId !== req.user.uid) {
        return res
          .status(403)
          .send({ message: "Forbidden: You can only view your own bookings" });
      }

      const query = {};

      if (renterId) {
        query.renterId = renterId;
      }
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    });

    // Private
    app.delete("/bookings/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;

      const existingBooking = await bookingsCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!existingBooking) {
        return res.status(404).send({ message: "Booking not found" });
      }
      if (existingBooking.renterId !== req.user.uid) {
        return res.status(403).send({
          message: "Forbidden: You can only delete your own bookings",
        });
      }

      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.deleteOne(query);
      res.send(result);
    });

    // ============================================
    // REVIEWS API
    // ============================================

    // Public - Get reviews for a car or user
    app.get("/reviews", async (req, res) => {
      const carId = req.query.carId;
      const userId = req.query.userId;

      let query = {};

      if (carId) {
        query.carId = carId;
      } else if (userId) {
        query.renterId = userId;
      }

      const reviews = await reviewsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();

      // Enrich reviews with car details if missing
      const enrichedReviews = await Promise.all(
        reviews.map(async (review) => {
          // If review doesn't have car details, fetch them
          if (!review.carName || !review.carImage) {
            const car = await carsCollection.findOne({
              _id: new ObjectId(review.carId),
            });
            if (car) {
              review.carName = car.carName;
              review.carImage = car.imageURL;
            }
          }
          return review;
        })
      );

      res.send(enrichedReviews);
    });

    // Private - Add new review (check if user booked the car)
    app.post("/reviews", verifyFirebaseToken, async (req, res) => {
      const { carId, rating, comment, bookingId } = req.body;
      const renterId = req.user.uid;

      // Validate required fields
      if (!carId || !rating || !bookingId) {
        return res.status(400).send({
          message: "carId, rating, and bookingId are required",
        });
      }

      // Validate rating range
      if (rating < 1 || rating > 5) {
        return res
          .status(400)
          .send({ message: "Rating must be between 1 and 5" });
      }

      try {
        // Check if booking exists and belongs to user
        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(bookingId),
          renterId: renterId,
          carId: carId,
        });

        if (!booking) {
          return res.status(404).send({
            message: "Booking not found or does not belong to you",
          });
        }

        // Check if booking is completed
        if (booking.status !== "Completed") {
          return res.status(400).send({
            message: "You can only review completed rentals",
          });
        }

        // Check if user already reviewed this booking
        const existingReview = await reviewsCollection.findOne({
          bookingId: bookingId,
          renterId: renterId,
        });

        if (existingReview) {
          return res.status(400).send({
            message: "You have already reviewed this rental",
          });
        }

        // Get user details
        const user = await usersCollection.findOne({ uid: renterId });

        // Get car details
        const car = await carsCollection.findOne({ _id: new ObjectId(carId) });

        if (!car) {
          return res.status(404).send({ message: "Car not found" });
        }

        // Create review
        const review = {
          carId,
          carName: car.carName,
          carImage: car.imageURL,
          renterId,
          userName: user?.displayName || "Anonymous",
          userPhoto: user?.photoURL || null,
          rating: Number(rating),
          comment: comment || "",
          bookingId,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await reviewsCollection.insertOne(review);
        res.send(result);
      } catch (error) {
        console.error("Error creating review:", error);
        res.status(500).send({ message: "Error creating review" });
      }
    });

    // Private - Update own review
    app.put("/reviews/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const { rating, comment } = req.body;
      const renterId = req.user.uid;

      // Validate rating if provided
      if (rating && (rating < 1 || rating > 5)) {
        return res
          .status(400)
          .send({ message: "Rating must be between 1 and 5" });
      }

      try {
        const existingReview = await reviewsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!existingReview) {
          return res.status(404).send({ message: "Review not found" });
        }

        if (existingReview.renterId !== renterId) {
          return res.status(403).send({
            message: "Forbidden: You can only update your own reviews",
          });
        }

        const updateDoc = {
          $set: {
            ...(rating && { rating: Number(rating) }),
            ...(comment !== undefined && { comment }),
            updatedAt: new Date(),
          },
        };

        const result = await reviewsCollection.updateOne(
          { _id: new ObjectId(id) },
          updateDoc
        );
        res.send(result);
      } catch (error) {
        console.error("Error updating review:", error);
        res.status(500).send({ message: "Error updating review" });
      }
    });

    // Private - Delete own review
    app.delete("/reviews/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const renterId = req.user.uid;

      try {
        const existingReview = await reviewsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!existingReview) {
          return res.status(404).send({ message: "Review not found" });
        }

        if (existingReview.renterId !== renterId) {
          return res.status(403).send({
            message: "Forbidden: You can only delete your own reviews",
          });
        }

        const result = await reviewsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        console.error("Error deleting review:", error);
        res.status(500).send({ message: "Error deleting review" });
      }
    });

    // Public - Get car average rating
    app.get("/cars/:id/rating", async (req, res) => {
      const carId = req.params.id;

      try {
        const reviews = await reviewsCollection.find({ carId }).toArray();

        const totalReviews = reviews.length;
        const averageRating =
          totalReviews > 0
            ? reviews.reduce((sum, review) => sum + review.rating, 0) /
              totalReviews
            : 0;

        res.send({
          carId,
          averageRating: Number(averageRating.toFixed(1)),
          totalReviews,
        });
      } catch (error) {
        console.error("Error getting car rating:", error);
        res.status(500).send({ message: "Error getting car rating" });
      }
    });

    // Admin - Delete any review
    app.delete(
      "/admin/reviews/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const query = { _id: new ObjectId(id) };
          const result = await reviewsCollection.deleteOne(query);

          if (result.deletedCount === 0) {
            return res.status(404).send({ message: "Review not found" });
          }

          res.send({ message: "Review deleted successfully", result });
        } catch (error) {
          res.status(500).send({ message: "Error deleting review" });
        }
      }
    );

    // // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Rental Wheels Server is running");
});

app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});
