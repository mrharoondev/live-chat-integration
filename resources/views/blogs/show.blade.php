<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="csrf-token" content="{{ csrf_token() }}">

        <title>{{ $blog->title ?? 'Blog' }} - {{ config('app.name', 'Laravel') }}</title>

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
                        @auth
                            <a href="{{ route('dashboard') }}" class="inline-flex items-center text-gray-600 hover:text-gray-900 font-semibold transition">
                                <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
                                </svg>
                                Back to Blogs
                            </a>
                        @endauth
                        @guest
                            <a href="{{ route('login') }}" class="text-gray-600 hover:text-gray-900 font-semibold transition">
                                Login
                            </a>
                        @endguest
                    </div>
                </div>
            </nav>

            <!-- Main Content -->
            <div class="py-12">
                <div class="max-w-4xl mx-auto sm:px-6 lg:px-8">
                    <!-- Blog Article -->
                    <article class="bg-white overflow-hidden shadow-sm sm:rounded-lg">
                        <!-- Featured Image -->
                        <div class="relative h-96 bg-gray-200 overflow-hidden">
                            @if($blog->image)
                                <img
                                    src="{{ asset('storage/'.$blog->image) }}"
                                    alt="{{ $blog->title }}"
                                    class="w-full h-full object-cover"
                                >
                            @else
                                <div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-400 to-blue-600">
                                    <svg class="w-32 h-32 text-white opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                                    </svg>
                                </div>
                            @endif
                        </div>

                        <!-- Content Section -->
                        <div class="p-8 sm:p-10">
                            <!-- Title -->
                            <h1 class="text-4xl font-bold text-gray-900 mb-4">{{ $blog->title }}</h1>

                            <!-- Meta Information -->
                            <div class="flex flex-wrap items-center gap-6 text-sm text-gray-600 mb-8 pb-8 border-b border-gray-200">
                                <div class="flex items-center">
                                    <svg class="w-5 h-5 mr-2 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                                        <path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v2h16V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h12a1 1 0 100-2H6z" clip-rule="evenodd"></path>
                                    </svg>
                                    <span>{{ $blog->created_at->format('F d, Y') }}</span>
                                </div>

                                @if($blog->created_at != $blog->updated_at)
                                    <div class="flex items-center">
                                        <svg class="w-5 h-5 mr-2 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                                            <path fill-rule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"></path>
                                        </svg>
                                        <span>Updated {{ $blog->updated_at->format('F d, Y') }}</span>
                                    </div>
                                @endif
                            </div>

                            <!-- Blog Content -->
                            <div class="prose prose-lg max-w-none mb-8">
                                <p class="text-gray-700 leading-relaxed whitespace-pre-wrap">{{ $blog->content }}</p>
                            </div>

                            <!-- Action Buttons -->
                            @auth
                                <div class="flex gap-4 pt-8 border-t border-gray-200">
                                    <a
                                        href="{{ route('blogs.edit', $blog->id) ?? '#' }}"
                                        class="inline-flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition duration-200"
                                    >
                                        <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                                        </svg>
                                        Edit
                                    </a>

                                    <form
                                        action="{{ route('blogs.destroy', $blog->id) ?? '#' }}"
                                        method="POST"
                                        class="inline-block"
                                        onsubmit="return confirm('Are you sure you want to delete this blog?')"
                                    >
                                        @csrf
                                        @method('DELETE')
                                        <button
                                            type="submit"
                                            class="inline-flex items-center bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-6 rounded-lg transition duration-200"
                                        >
                                            <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                            </svg>
                                            Delete
                                        </button>
                                    </form>
                                </div>
                            @endauth
                        </div>
                    </article>

                    <!-- Related Posts Section -->
                    <div class="mt-16">
                        <h3 class="text-2xl font-bold text-gray-900 mb-6">More Blogs</h3>
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            @php
                                $relatedBlogs = \App\Models\Blog::where('id', '!=', $blog->id)->limit(3)->get();
                            @endphp
                            @forelse($relatedBlogs as $relatedBlog)
                                <a
                                    href="{{ route('blogs.show', $relatedBlog->id) }}"
                                    class="group bg-white overflow-hidden shadow-md hover:shadow-lg rounded-lg transition duration-300 transform hover:scale-105"
                                >
                                    <div class="relative h-40 bg-gray-200 overflow-hidden">
                                        @if($relatedBlog->image)
                                            <img
                                                src="{{ asset('storage/' . $relatedBlog->image) }}"
                                                alt="{{ $relatedBlog->title }}"
                                                class="w-full h-full object-cover group-hover:scale-110 transition duration-300"
                                            >
                                        @else
                                            <div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-300 to-gray-400">
                                                <svg class="w-12 h-12 text-gray-500 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                                                </svg>
                                            </div>
                                        @endif
                                    </div>
                                    <div class="p-4">
                                        <h4 class="font-bold text-gray-900 group-hover:text-blue-600 transition line-clamp-2">{{ $relatedBlog->title }}</h4>
                                        <p class="text-xs text-gray-500 mt-2">{{ $relatedBlog->created_at->format('M d, Y') }}</p>
                                    </div>
                                </a>
                            @empty
                                <p class="text-gray-500 col-span-full">No more blogs available.</p>
                            @endforelse
                        </div>
                    </div>
                </div>
            </div>
        </div>

        @include('partials.chat-widget')
    </body>
</html>
