#!/bin/bash

# Pull from S3
aws s3 sync s3://ethereum-blockchain-analysis-svitali .

# Push to S3
aws s3 sync ./ethereumetl/export s3://ethereum-blockchain-analysis-svitali/ethereumetl/export
