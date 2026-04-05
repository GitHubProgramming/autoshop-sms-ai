import express from 'express';
import { healthCheck } from './routes/health';

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Health check route
app.get('/health', healthCheck);
app.get('/ar-vis-dar-dirba', healthCheck); // Lithuanian endpoint

// Default route
app.get('/', (req, res) => {
  res.json({ message: 'API is running' });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

export default app;
