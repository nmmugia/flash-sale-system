import FlashSale from './components/FlashSale'

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-md border-b-2 border-primary-500">
        <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <img
              src="/images/bookipi-logo.png"
              alt="Bookipi"
              className="h-10"
            />
            <div className="border-l-2 border-gray-300 pl-4">
              <h1 className="text-2xl font-bold text-gray-900">Flash Sale</h1>
              <p className="text-sm text-gray-600">Limited time exclusive offers</p>
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <FlashSale />
      </main>
      <footer className="bg-white border-t mt-12">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <p className="text-center text-gray-500 text-sm">
            Powered by <span className="font-semibold text-primary-600">Bookipi</span> Flash Sale System
          </p>
        </div>
      </footer>
    </div>
  )
}

export default App
