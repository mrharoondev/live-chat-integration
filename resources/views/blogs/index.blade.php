<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="csrf-token" content="{{ csrf_token() }}">

        <title>All Blogs - {{ config('app.name', 'Laravel') }}</title>

        <!-- Fonts -->
        <link rel="preconnect" href="https://fonts.bunny.net">
        <link href="https://fonts.bunny.net/css?family=figtree:400,500,600&display=swap" rel="stylesheet" />

        <!-- Scripts -->
        @vite(['resources/css/app.css', 'resources/js/app.js'])
    </head>
    <body class="font-sans text-gray-900 antialiased bg-gray-50">
        <div class="min-h-screen">
            <!-- Navigation -->
            <nav class="bg-white shadow-sm border-b border-gray-200">
                <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <div class="flex justify-between items-center">
                        <a href="/" class="text-2xl font-bold text-blue-600">Blog</a>
                        <div class="flex gap-4">
                            @auth
                                <a href="{{ route('dashboard') }}" class="inline-flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition duration-200">
                                    Dashboard
                                </a>
                            @else
                                <a href="{{ route('login') }}" class="text-gray-600 hover:text-gray-900 font-semibold transition">
                                    Login
                                </a>
                            @endauth
                        </div>
                    </div>
                </div>
            </nav>

            <!-- Header Section -->
            <div class="bg-white border-b border-gray-200">
                <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                    <h1 class="text-4xl font-bold text-gray-900 mb-3">All Blogs</h1>
                    <p class="text-xl text-gray-600">Explore our latest articles and stories</p>
                </div>
            </div>

            <!-- Blog Grid -->
            <div class="py-12">
                <div class="max-w-7xl mx-auto sm:px-6 lg:px-8">
                    @if (!empty($blogs) && $blogs->count() > 0)
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            @foreach($blogs as $blog)
                                <a
                                    href="{{ route('blogs.show', $blog->id) }}"
                                    class="group bg-white overflow-hidden shadow-md hover:shadow-lg rounded-lg transition duration-300 transform hover:scale-105"
                                >
                                    <!-- Image Section -->
                                    <div class="relative h-48 bg-gray-200 overflow-hidden">
                                        @if($blog->image)
                                            <img
                                                src="{{ asset('storage/' . $blog->image) }}"
                                                alt="{{ $blog->title }}"
                                                class="w-full h-full object-cover group-hover:scale-110 transition duration-300"
                                            >
                                        @else
                                            <div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-400 to-blue-600">
                                                <svg class="w-20 h-20 text-white opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                                                </svg>
                                            </div>
                                        @endif
                                    </div>

                                    <!-- Content Section -->
                                    <div class="p-5">
                                        <h2 class="text-lg font-bold text-gray-900 mb-2 line-clamp-2 group-hover:text-blue-600 transition">{{ $blog->title }}</h2>

                                        <p class="text-gray-600 text-sm mb-4 line-clamp-3">{{ Str::limit($blog->content, 150) }}</p>

                                        <!-- Metadata -->
                                        <div class="flex items-center justify-between text-xs text-gray-500 mb-4 pb-4 border-b border-gray-200">
                                            <span>{{ $blog->created_at->format('M d, Y') }}</span>
                                        </div>

                                        <!-- Read More Button -->
                                        <div class="inline-block w-full text-center bg-blue-600 group-hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition duration-200">
                                            Read More →
                                        </div>
                                    </div>
                                </a>
                            @endforeach
                        </div>
                    @else
                        <div class="bg-white rounded-lg shadow-sm p-12 text-center">
                            <svg class="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m0 0h6m0 0v-6m0 6v6M4 12v6m0 0v6m0-6h6m0 0h6"></path>
                            </svg>
                            <h3 class="text-lg font-semibold text-gray-900 mb-2">No blogs yet</h3>
                            <p class="text-gray-600">Check back soon for exciting content!</p>
                        </div>
                    @endif
                </div>
            </div>

            <!-- Footer -->
            <footer class="bg-white border-t border-gray-200 mt-16">
                <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    <div class="text-center text-gray-600">
                        <p>&copy; {{ date('Y') }} {{ config('app.name', 'Laravel') }}. All rights reserved.</p>
                    </div>
                </div>
            </footer>
        </div>

        @include('partials.chat-widget')
    </body>
</html>
