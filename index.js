const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const dotenv = require("dotenv");
dotenv.config();
const admin = require("firebase-admin");

const uri = process.env.URI;
const serviceAccount = require("./rentwheel-firebase-admin.json");

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
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const db = client.db("rentalwheels");
    const usersCollection = db.collection("users");
    const carsCollection = db.collection("cars");
    const bookingsCollection = db.collection("bookings");

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
      const query = { email: user.email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await usersCollection.updateOne(query, updateDoc, options);
      res.send(result);
    });

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

    // Public
    app.get("/cars", async (req, res) => {
      const email = req.query.email;
      const searchQuery = req.query.search;

      const query = {};

      if (email) {
        query.providerEmail = email;
      }

      if (searchQuery) {
        query.carName = { $regex: searchQuery, $options: "i" };
      }

      const cars = await carsCollection.find(query).toArray();
      res.send(cars);
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
      if (existingCar.providerEmail !== req.user.email) {
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
      if (existingCar.providerEmail !== req.user.email) {
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

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
    app.listen(port, () => {
      console.log(`Server is running on port: ${port}`);
    });
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Rental Wheels Server is running");
});
