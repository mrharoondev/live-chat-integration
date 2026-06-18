<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Blog;
use Illuminate\Http\Request;

class BlogController extends Controller
{
    public function index(Request $request)
    {
        $query = Blog::query()->with('user:id,name,email')->latest();

        // Match by author email (users table), not a non-existent blogs.email column.
        if ($request->filled('email')) {
            $query->whereHas('user', function ($q) use ($request) {
                $q->where('email', $request->string('email'));
            });
        }

        $blogs = $query->get()->map(function (Blog $blog) {
            return array_merge($blog->toArray(), [
                'email' => $blog->user?->email,
            ]);
        });

        return response()->json($blogs);
    }

    public function show($id)
    {
        $blog = Blog::with('user:id,name,email')->findOrFail($id);

        return response()->json(array_merge($blog->toArray(), [
            'email' => $blog->user?->email,
        ]));
    }

    public function store(Request $request)
    {
        $request->validate([
            'title' => 'required',
            'content' => 'required',
        ]);

        $blog = Blog::create([
            'user_id' => $request->user()->id,
            'title' => $request->title,
            'content' => $request->content,
        ]);

        $blog->load('user:id,name,email');

        return response()->json(array_merge($blog->toArray(), [
            'email' => $blog->user?->email,
        ]));
    }
}
