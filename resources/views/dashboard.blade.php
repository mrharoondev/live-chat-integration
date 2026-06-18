<x-app-layout>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">
            {{ __('Dashboard') }}
        </h2>
    </x-slot>

    <div class="py-12">
        <div class="max-w-7xl mx-auto sm:px-6 lg:px-8">
            <!-- Header Section -->
            <div class="mb-8 flex justify-between items-center">
                <div>
                    <h1 class="text-3xl font-bold text-gray-900">All Blogs</h1>
                    <p class="text-gray-600 mt-1">Explore our latest blog posts</p>
                </div>
                @auth
                    <a href="{{ route('blogs.create') }}" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition duration-200 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500">
                        + Create Blog
                    </a>
                @endauth
            </div>

            <!-- Blog Cards Grid -->
            @if (!empty($blogs))
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    @foreach($blogs as $blog)
                        <div class="bg-white overflow-hidden shadow-md hover:shadow-lg rounded-lg transition duration-300 transform hover:scale-105">
                            <!-- Image Section -->
                            <div class="relative h-48 bg-gray-200 overflow-hidden">
                                @if($blog->image)
                                    <img
                                        src="{{ asset('storage/' . $blog->image) }}"
                                        alt="{{ $blog->title }}"
                                        class="w-full h-full object-cover"
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
                                <h2 class="text-lg font-bold text-gray-900 mb-2 line-clamp-2">{{ $blog->title }}</h2>

                                <p class="text-gray-600 text-sm mb-4 line-clamp-3">{{ Str::limit($blog->content, 150) }}</p>

                                <!-- Metadata -->
                                <div class="flex items-center justify-between text-xs text-gray-500 mb-4 pb-4 border-b border-gray-200">
                                    {{-- <span>{{ $blog->created_at->format('M d, Y') }}</span> --}}
                                </div>

                                <!-- Read More Button -->
                                <a
                                    href="{{ route('blogs.show', $blog->id) }}"
                                    class="inline-block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition duration-200"
                                >
                                    Read More →
                                </a>
                            </div>
                        </div>
                    @endforeach
                </div>
            @else
                <div class="bg-white rounded-lg shadow-sm p-12 text-center">
                    <svg class="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m0 0h6m0 0v-6m0 6v6M4 12v6m0 0v6m0-6h6m0 0h6"></path>
                    </svg>
                    <h3 class="text-lg font-semibold text-gray-900 mb-2">No blogs yet</h3>
                    <p class="text-gray-600 mb-6">Start creating your first blog post to get started.</p>
                    @auth
                        <a href="{{ route('blogs.create') }}" class="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition duration-200">
                            Create First Blog
                        </a>
                    @endauth
                </div>
            @endif
        </div>
    </div>
</x-app-layout>
