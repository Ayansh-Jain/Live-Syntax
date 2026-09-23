const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    fileStructure: {
      type: Object,
      required: true,
    },
    fileContents: {
      type: Object,
      required: true,
    },
    projectName: {
      type: String,
      default: 'Untitled Project',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Project', projectSchema);
