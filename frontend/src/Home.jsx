
// Home.jsx
import { useEffect } from "react";
import App from "./App.jsx";
import "./index.css";
import "./App.css";

export default function Home() {
  useEffect(() => {
    document.title = "CareLens | Value-Based Care Analytics";
  }, []);

  return (
    <div className="carelens-home">
      <App />
    </div>
  );
}