const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const dotenv = require("dotenv");
dotenv.config();

const uri = process.env.URI;

app.use(cors());
app.use(express.json());
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
    app.get("/users", async (req, res) => {
      const cursor = usersCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

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
    // POST - Add a new car (Private)
    app.post("/cars", async (req, res) => {
      const car = req.body;
      const result = await carsCollection.insertOne(car);
      res.send(result);
    });

    // GET - Get a specific car's details (Public)
    app.get("/cars/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const car = await carsCollection.findOne(query);
      res.send(car);
    });

    // GET - Get cars created by logged-in provider (Private)
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

    // PUT - Update existing car (Private)
    app.put("/cars/:id", async (req, res) => {
      const id = req.params.id;
      const updatedCar = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: updatedCar,
      };
      const result = await carsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // PATCH - Update car status (Private)
    app.patch("/cars/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { status },
      };
      const result = await carsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // DELETE - Delete a car (Private)
    app.delete("/cars/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await carsCollection.deleteOne(query);
      res.send(result);
    });

    // Bookings API
    // POST - Book a car (Private)
    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });

    // GET - Get bookings by user email (Private)
    app.get("/bookings", async (req, res) => {
      const renterId = req.query.renterId;

      const query = {};

      if (renterId) {
        query.renterId = renterId;
      }
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    });

    // DELETE - Delete a booking (Private)
    app.delete("/bookings/:id", async (req, res) => {
      const id = req.params.id;
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
