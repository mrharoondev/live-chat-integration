<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Blog extends Model
{
    protected $fillable = ['user_id', 'title', 'content', 'image'];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
