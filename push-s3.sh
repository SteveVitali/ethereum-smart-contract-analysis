#!/bin/bash

# Push to S3
aws s3 sync ./ethereumetl/export s3://ethereum-blockchain-analysis-svitali/ethereumetl/export

