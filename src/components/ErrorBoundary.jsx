import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    this.state = { hasError: true, error, errorInfo };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-red-50 p-8">
          <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg p-6">
            <h1 className="text-2xl font-bold text-red-600 mb-4">エラーが発生しました</h1>
            <div className="space-y-4">
              <div>
                <h2 className="font-semibold mb-2">エラーメッセージ:</h2>
                <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm">
                  {this.state.error?.toString()}
                </pre>
              </div>
              <div>
                <h2 className="font-semibold mb-2">スタックトレース:</h2>
                <pre className="bg-gray-100 p-4 rounded overflow-auto text-xs">
                  {this.state.error?.stack}
                </pre>
              </div>
              {this.state.errorInfo && (
                <div>
                  <h2 className="font-semibold mb-2">コンポーネントスタック:</h2>
                  <pre className="bg-gray-100 p-4 rounded overflow-auto text-xs">
                    {this.state.errorInfo.componentStack}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;