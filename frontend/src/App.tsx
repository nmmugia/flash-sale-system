import { useState, useEffect } from 'react'
import FlashSale from './components/FlashSale'

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-primary-500 text-white shadow-lg">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold">Flash Sale System</h1>
          <p className="mt-1 text-primary-100">High-throughput system demo with circuit breaker pattern</p>
        </div>
      </header>
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <FlashSale />
      </main>
    </div>
  )
}

export default App
