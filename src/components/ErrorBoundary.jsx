import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, errorStack: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // 確実に文字列化してエラー情報を保存
    const errorMessage = error instanceof Error ? error.message : String(error ?? 'unknown error');
    const errorStack = error instanceof Error ? (error.stack ?? '') : JSON.stringify(error, null, 2);
    const componentStack = errorInfo?.componentStack || 'no component stack';
    
    console.error('ErrorBoundary caught:', errorMessage);
    console.error('Stack:', errorStack);
    console.error('Component Stack:', componentStack);
    
    this.setState({ 
      error: errorMessage,
      errorInfo: componentStack,
      errorStack: errorStack
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-red-50 p-8">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-4xl w-full">
            <h2 className="text-2xl font-bold text-red-600 mb-4">
              ⚠️ Error Caught by ErrorBoundary
            </h2>
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold mb-2">Error Message:</h3>
                <pre className="bg-red-100 p-4 rounded overflow-auto text-sm border border-red-300">
                  {this.state.error || '(empty)'}
                </pre>
              </div>
              {this.state.errorStack && (
                <div>
                  <h3 className="font-semibold mb-2">Stack Trace:</h3>
                  <pre className="bg-gray-100 p-4 rounded overflow-auto text-xs border border-gray-300 max-h-64">
                    {this.state.errorStack}
                  </pre>
                </div>
              )}
              {this.state.errorInfo && (
                <div>
                  <h3 className="font-semibold mb-2">Component Stack:</h3>
                  <pre className="bg-gray-100 p-4 rounded overflow-auto text-xs border border-gray-300 max-h-64">
                    {this.state.errorInfo}
                  </pre>
                </div>
              )}
              <div className="flex gap-4">
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Reload Page
                </button>
                <button
                  onClick={() => this.setState({ hasError: false, error: null, errorInfo: null, errorStack: null })}
                  className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
                >
                  Try Again
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;